import {it,expect,vi} from 'vitest';
import {NativeProjectTransfer} from '../apps/desktop/src/project-transfer.js';
import {isSharedRoute} from '../apps/desktop/src/shared-http.js';
import {isLocalRoute} from '../apps/desktop/src/local-http.js';
const project='11111111-1111-4111-8111-111111111111';
it('does not expose transfer transport to renderer fetch',()=>{const path=`/v1/desktop/projects/${project}/transfer/export`;expect(isSharedRoute('POST',path)).toBe(false);expect(isLocalRoute('POST',path)).toBe(false);});
it('permits encoded Truth Inbox IDs but not encoded route separators or authority paths',()=>{
 const path=`/v1/projects/${project}/truth-inbox/proposal%3A${project}`;
 expect(isSharedRoute('GET',path+'/packet')).toBe(true);
 expect(isSharedRoute('POST',path+'/actions/accept')).toBe(true);
 expect(isSharedRoute('GET',`/v1/projects/${project}/delivery/traces/proposal%3A${project}`)).toBe(true);
 expect(isSharedRoute('POST',`/v1/projects/${project}/delivery/receipts/proposal%3A${project}`)).toBe(true);
 expect(isSharedRoute('GET',path.replace('%3A','%2F')+'/packet')).toBe(false);
 expect(isSharedRoute('GET','/v1/mcp%2Ftokens')).toBe(false);
});
function setup(){
 const send=vi.fn(async(action:string)=>action==='preview'?{digest:'a'.repeat(64),actors:[],targetIdentities:[],counts:{},source:{name:'Test'}}:{projectId:project});
 const controller=new NativeProjectTransfer({send,choose:async()=>Buffer.from('encrypted fixture'),passphrase:async()=> 'synthetic-passphrase',save:async()=>({cancelled:false}),confirm:async()=>true});
 return {send,controller};
}
it('returns only an opaque review ID, never archive bytes or its passphrase',async()=>{
 const {controller}=setup(),result=await controller.preview(project);
 expect(result).toHaveProperty('previewId');expect(JSON.stringify(result)).not.toContain('encrypted fixture');expect(JSON.stringify(result)).not.toContain('synthetic-passphrase');controller.close();
});
it('rejects another destination, unknown preview, and missing consent without writing',async()=>{
 const {controller,send}=setup(),preview=await controller.preview(project);
 await expect(controller.commit({projectId:project,previewId:'22222222-2222-4222-8222-222222222222',identityMap:{},acknowledgeHistoricalTruth:true})).rejects.toThrow();
 await expect(controller.commit({projectId:project,previewId:preview.previewId,identityMap:{},acknowledgeHistoricalTruth:false})).rejects.toThrow();
 expect(send).toHaveBeenCalledTimes(1);controller.close();
});
it('drops pending authority on close and rejects subsequent commit',async()=>{
 const {controller}=setup(),preview=await controller.preview(project);controller.close();
 await expect(controller.commit({projectId:project,previewId:preview.previewId,identityMap:{},acknowledgeHistoricalTruth:true})).rejects.toThrow();
});
it.each(['export','preview'] as const)('does not send %s after the window closes during its passphrase dialog',async(action)=>{
 let resolve!:(value:string)=>void;
 const send=vi.fn();
 const controller=new NativeProjectTransfer({send,choose:async()=>Buffer.from('fixture'),passphrase:()=>new Promise(r=>{resolve=r;}),save:vi.fn(),confirm:async()=>true});
 const operation=controller[action](project);
 await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
 controller.close();resolve('synthetic-passphrase');
 await expect(operation).rejects.toThrow('Window closed');
 expect(send).not.toHaveBeenCalled();
});
it('expires a preview without allowing an import',async()=>{
 vi.useFakeTimers();
 const {controller,send}=setup();
 try{
  const preview=await controller.preview(project);
  await vi.advanceTimersByTimeAsync(300001);
  await expect(controller.commit({projectId:project,previewId:preview.previewId,identityMap:{},acknowledgeHistoricalTruth:true})).rejects.toThrow('expired');
  expect(send).toHaveBeenCalledTimes(1);
 }finally{controller.close();vi.useRealTimers();}
});
it('does not import if confirmation is cancelled',async()=>{
 const send=vi.fn(async()=>({digest:'a'.repeat(64)}));
 const controller=new NativeProjectTransfer({send,choose:async()=>Buffer.from('fixture'),passphrase:async()=> 'synthetic-passphrase',save:vi.fn(),confirm:async()=>false});
 try{
  const preview=await controller.preview(project);
  expect(await controller.commit({projectId:project,previewId:preview.previewId,identityMap:{},acknowledgeHistoricalTruth:true})).toEqual({cancelled:true});
  expect(send).toHaveBeenCalledTimes(1);
 }finally{controller.close();}
});
it('does not import when the preview expires during confirmation',async()=>{
 vi.useFakeTimers();
 const send=vi.fn(async()=>({digest:'a'.repeat(64)}));
 const controller=new NativeProjectTransfer({send,choose:async()=>Buffer.from('fixture'),passphrase:async()=> 'synthetic-passphrase',save:vi.fn(),confirm:async()=>{await vi.advanceTimersByTimeAsync(300001);return true;}});
 try{
  const preview=await controller.preview(project);
  await expect(controller.commit({projectId:project,previewId:preview.previewId,identityMap:{},acknowledgeHistoricalTruth:true})).rejects.toThrow('expired');
  expect(send).toHaveBeenCalledTimes(1);
 }finally{controller.close();vi.useRealTimers();}
});
