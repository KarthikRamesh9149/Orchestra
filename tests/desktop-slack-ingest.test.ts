import {describe,it,expect,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {ingestDesktopSlack} from '../src/desktop/slack-ingest.js';
import {commandSchema} from '../apps/desktop/src/contracts.js';
const actor={id:'00000000-0000-4000-8000-000000000001',orgId:'00000000-0000-4000-8000-000000000002'};
const batch={operation:'desktop.slack.ingest',projectId:'00000000-0000-4000-8000-000000000003',teamId:'TTEST',teamName:'Synthetic',channel:{id:'CTEST',name:'test'},messages:[]};
describe('desktop Slack provenance boundary',()=>{
 it('cannot be forged through renderer commands',()=>{expect(commandSchema.safeParse(batch).success).toBe(false);});
 it('requires active manager membership before opening a transaction',async()=>{
  for(const membership of [null,{projectRole:'dev'},{projectRole:'client'}]){const db={projectMember:{findFirst:vi.fn().mockResolvedValue(membership)},$transaction:vi.fn()};
   await expect(ingestDesktopSlack(db as unknown as PrismaClient,actor,batch)).rejects.toThrow();expect(db.$transaction).not.toHaveBeenCalled();}
 });
 it('refuses to overwrite a hosted or different-team connector',async()=>{
  for(const configJson of [{teamId:'TTEST'},{desktop:true,teamId:'TOTHER'}]){
   const tx={$queryRaw:vi.fn(),communicationConnector:{findUnique:vi.fn().mockResolvedValue({configJson}),upsert:vi.fn()}};
   const db={projectMember:{findFirst:vi.fn().mockResolvedValue({projectRole:'manager'})},$transaction:vi.fn(async(callback:(db:unknown)=>Promise<unknown>)=>callback(tx))};
   await expect(ingestDesktopSlack(db as unknown as PrismaClient,actor,batch)).rejects.toThrow('Different Slack');expect(tx.communicationConnector.upsert).not.toHaveBeenCalled();
  }
 });
});
