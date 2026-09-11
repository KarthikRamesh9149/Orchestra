import {describe,it,expect,vi} from 'vitest';
import {MessageIndexingService} from '../src/modules/communications/message-indexing.service.js';
import {AppError} from '../src/app/errors.js';
import {stableBodyHash} from '../src/lib/communications/idempotency.js';

function fixture(provider:any){
 const message={id:'message',projectId:'project',connectorId:'connector',threadId:'thread',provider:'slack',senderLabel:'Tester',senderEmail:null,sentAt:new Date('2026-09-01'),bodyText:'Synthetic CSV export requires item_id and title.',bodyHtml:null,bodyHash:stableBodyHash('Synthetic CSV export requires item_id and title.',null),thread:{subject:'Synthetic test',participantsJson:[]},attachments:[],connector:{id:'connector'},project:{orgId:'org'},rawMetadataJson:{}};
 let chunks:any[]=[];
 const db:any={communicationMessage:{findUnique:vi.fn(async()=>message),update:vi.fn()},communicationMessageChunk:{findMany:vi.fn(async()=>chunks),deleteMany:vi.fn(async()=>{chunks=[];}),create:vi.fn(async({data})=>{const row={id:'chunk',...data};chunks.push(row);return row;})},$executeRawUnsafe:vi.fn()};
 const service=new MessageIndexingService(db,provider,{record:vi.fn()} as any,{enqueue:vi.fn()} as any,{BETA_COMMUNICATION_AUTO_CLASSIFY_ENABLED:false,BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED:false});
 return {db,service,message};
}
describe('desktop communication lexical indexing',()=>{
 it('keeps searchable evidence without an embedding provider and is idempotent',async()=>{
  const embedText=vi.fn();const {service,db}=fixture({unavailable:true,embedText});
  expect(await service.indexCommunicationMessage('message')).toMatchObject({indexed:true,chunkCount:1});
  expect(db.communicationMessageChunk.create.mock.calls[0][0].data).toMatchObject({lexicalContent:expect.stringContaining('item_id'),metadataJson:{semanticIndexed:false}});
  expect(await service.indexCommunicationMessage('message')).toMatchObject({indexed:false,chunkCount:1});
  expect(embedText).not.toHaveBeenCalled();expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
 });
 it('reindexes lexical-only chunks after semantic configuration becomes available',async()=>{
  const provider={unavailable:true,embedText:vi.fn(async()=>[0.1])};const {service,db}=fixture(provider);
  await service.indexCommunicationMessage('message');provider.unavailable=false;
  await service.indexCommunicationMessage('message');await service.indexCommunicationMessage('message');
  expect(provider.embedText).toHaveBeenCalledTimes(1);expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1);
 });
 it('preserves lexical evidence when the configured request allowance is exhausted',async()=>{
  const {service,db}=fixture({embedText:vi.fn(async()=>{throw new AppError(429,'Allowance exhausted','ai_request_budget_exceeded');})});
  await service.indexCommunicationMessage('message');expect(db.communicationMessageChunk.create).toHaveBeenCalled();expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
 });
 it('does not suppress unexpected provider failures',async()=>{
  const {service}=fixture({embedText:vi.fn(async()=>{throw new Error('unexpected');})});
  await expect(service.indexCommunicationMessage('message')).rejects.toThrow('unexpected');
 });
});
