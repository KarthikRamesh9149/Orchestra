import type { PrismaClient, Prisma } from "@prisma/client";
import type { JobHandler } from "./queue.js";
import type { JobName } from "./types.js";
import { PostgresJobDispatcher } from "./postgres.js";

/** Reuses the active transaction when an imported service requests nesting.
 * Outer Serializable transaction provides the strongest requested isolation. */
export function transactionClient(tx:Prisma.TransactionClient):PrismaClient {
  let facade:PrismaClient;
  facade=new Proxy(tx,{get(target,property){
    if(property==='$transaction')return async (operation:unknown)=>typeof operation==='function'?operation(facade):Promise.all(operation as Promise<unknown>[]);
    if(property==='$disconnect'||property==='$connect')return async()=>{throw new Error('Transaction lifecycle belongs to the local worker');};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }}) as PrismaClient;
  return facade;
}

export class PostgresWorker {
  private stopped=true;
  private loop:Promise<void>|null=null;
  constructor(private db:PrismaClient,private handlers:(tx:PrismaClient)=>Partial<Record<JobName,JobHandler>>,private onError:(error:unknown)=>void=()=>{},private leaseMs=30_000){}
  async runOnce(){
    const queue=new PostgresJobDispatcher(this.db,this.leaseMs);
    const claim=await queue.claim();await this.reconcileFailures();if(!claim)return false;
    try{
      await this.db.$transaction(async tx=>{
        const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM desktop_jobs WHERE id=${claim.id}::uuid
          AND status='running' AND owner_token=${claim.owner_token}::uuid AND fence=${claim.fence} AND lease_until>now() FOR NO KEY UPDATE`;
        if(!rows.length)throw new Error('Job ownership lost before execution');
        const handler=this.handlers(transactionClient(tx))[claim.name];if(!handler)throw new Error('Unknown desktop job');
        let timer:ReturnType<typeof setInterval>|undefined;
        try{
          await Promise.race([handler(claim.payload),new Promise<never>((_,reject)=>{
            timer=setInterval(()=>{void this.db.$queryRaw<Array<{job_id:string}>>`SELECT job_id FROM desktop_job_cancellations WHERE job_id=${claim.id}::uuid`
              .then(rows=>{if(rows.length)reject(new Error('Job cancellation requested'));}).catch(reject);},100);
          })]);
        }finally{if(timer)clearInterval(timer);}
        // Holding this row lock protects the entire effect transaction. An
        // expiry sweeper skips locked rows; cancellation serializes with commit.
        await tx.$executeRaw`UPDATE desktop_jobs SET status='completed',owner_token=NULL,lease_until=NULL,updated_at=now()
          WHERE id=${claim.id}::uuid AND owner_token=${claim.owner_token}::uuid AND fence=${claim.fence} AND status='running'`;
      },{isolationLevel:'Serializable',maxWait:5000,timeout:120000});
    }catch(error){await queue.fail(claim);await this.reconcileFailures();this.onError(error);}
    return true;
  }
  /** Only terminal queue failures affect unfinished domain work. Completed
   * decisions and newer document revisions must never be reset by an old job. */
  private async reconcileFailures(){
    await this.db.$executeRaw`UPDATE document_versions v SET status='failed',processed_at=now()
      FROM desktop_jobs j WHERE j.status IN ('failed','cancelled')
      AND j.name IN ('parse_document','chunk_document','embed_document_chunks')
      AND v.id::text=j.payload->>'documentVersionId'
      AND v.parse_revision::text=j.payload->>'parseRevision' AND v.status IN ('pending','processing')`;
    await this.db.$executeRaw`UPDATE deep_research_runs r SET status='failed',progress_stage='failed',
      error_message='Local worker stopped or could not execute this run. Retry after resolving the cause.',
      completed_at=now(),lease_owner_token=NULL,lease_expires_at=NULL
      FROM desktop_jobs j WHERE j.status IN ('failed','cancelled') AND j.name='deep_research_run'
      AND r.id::text=j.payload->>'runId' AND r.project_id::text=j.payload->>'projectId' AND r.status IN ('queued','running')`;
    await this.db.$executeRaw`UPDATE job_runs r SET status='failed',finished_at=now(),last_error=COALESCE(j.failure_code,'cancelled')
      FROM desktop_jobs j WHERE j.status IN ('failed','cancelled') AND r.idempotency_key=j.idempotency_key
      AND r.status IN ('pending','running')`;
  }
  start(){if(this.loop)return;this.stopped=false;this.loop=(async()=>{while(!this.stopped){try{if(await this.runOnce())continue;}catch(error){this.onError(error);}await new Promise(resolve=>setTimeout(resolve,100));}})();}
  async close(){this.stopped=true;await this.loop;this.loop=null;}
}
