import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { PostgresJobDispatcher } from "../src/lib/jobs/postgres.js";

const enabled=process.env.DESKTOP_DB_TEST==='1';
if(enabled){
 const url=new URL(process.env.DATABASE_URL!);
 if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/orchestra_desktop')throw new Error('Refusing database tests outside the isolated desktop fixture');
}
describe.skipIf(!enabled)('isolated plain PostgreSQL durable jobs',()=>{
 const db=new PrismaClient();
 const prefix=`step2-test-${randomUUID()}`;
 const queue=new PostgresJobDispatcher(db,500);
 beforeAll(async()=>{
  const existing=await db.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM desktop_jobs WHERE status IN ('queued','running')`;
  if(Number(existing[0].count)!==0)throw new Error('Test requires an idle isolated job table; refusing to claim pre-existing work');
 });
 afterAll(async()=>{await db.$executeRaw`DELETE FROM desktop_jobs WHERE idempotency_key LIKE ${prefix+'%'}`;await db.$disconnect();});
 it('runs only against the explicitly isolated local database',()=>{
  const url=new URL(process.env.DATABASE_URL!);
  expect(url.hostname).toBe('127.0.0.1');expect(url.port).toBe('55439');expect(url.pathname).toBe('/orchestra_desktop');
 });
 it('preserves history and installed extensions',async()=>{
  const rows=await db.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  expect(Number(rows[0].count)).toBeGreaterThanOrEqual(82);
  const extensions=await db.$queryRaw<Array<{extname:string}>>`SELECT extname FROM pg_extension`;
  expect(extensions.map(x=>x.extname)).toEqual(expect.arrayContaining(['vector','pgcrypto','pg_trgm']));
 });
 it('enqueues idempotently, forbids payload replacement and serializes competing claims',async()=>{
  await Promise.all(Array.from({length:8},()=>queue.enqueue('refresh_dashboard_snapshot',{test:true},prefix+'-same')));
  await expect(queue.enqueue('refresh_dashboard_snapshot',{test:false},prefix+'-same')).rejects.toThrow('different payload');
  const claims=await Promise.all(Array.from({length:8},()=>queue.claim()));
  expect(claims.filter(Boolean)).toHaveLength(1);
  const job=claims.find(Boolean)!;
  expect(await queue.heartbeat(job)).toBe(true);
  expect(await queue.complete({...job,owner_token:randomUUID()})).toBe(false);
  expect(await queue.complete(job)).toBe(true);
  expect(await queue.complete(job)).toBe(false);
 });
 it('invalidates completion after cancellation',async()=>{
  await queue.enqueue('refresh_dashboard_snapshot',{test:true},prefix+'-cancel');const job=(await queue.claim())!;
  expect(await queue.cancel(job.id)).toBe(true);expect(await queue.complete(job)).toBe(false);expect(await queue.heartbeat(job)).toBe(false);
 });
 it('reconciles an actual killed claimant as failed rather than permanently running',async()=>{
  await queue.enqueue('refresh_dashboard_snapshot',{test:true},prefix+'-crash');
  const child=fork('scripts/desktop/claim-and-wait.mjs',[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','ignore','ipc']});
  try{
   const message=await Promise.race([once(child,'message'),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('claim timeout')),5000))]);
   expect(message[0]).toEqual(expect.objectContaining({claimed:true}));
   const exited=once(child,'exit');child.kill('SIGKILL');await exited;
   await new Promise(resolve=>setTimeout(resolve,650));
   expect(await queue.claim()).toBeNull();
   const rows=await db.$queryRaw<Array<{status:string,failure_code:string}>>`SELECT status,failure_code FROM desktop_jobs WHERE idempotency_key=${prefix+'-crash'}`;
   expect(rows[0]).toEqual({status:'failed',failure_code:'worker_lease_expired'});
  }finally{if(child.exitCode===null)child.kill('SIGKILL');}
 },10_000);
});
