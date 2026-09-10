import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AiLimiter, DailyCostLimitInput, LimitDecision } from './ai-limits.js';

type State={timestamps?:number[];holds?:Array<{id:string;until:number}>;day?:string;cost?:number};
export class PostgresAiLimiter implements AiLimiter {
 private held=new Map<string,string[]>();
 private timer:ReturnType<typeof setInterval>;
 constructor(private db:PrismaClient){this.timer=setInterval(()=>{void this.renew().catch(()=>{});},10_000);this.timer.unref();}
 private async mutate<T>(keys:string[],fn:(states:Map<string,State>)=>T):Promise<T>{
  return this.db.$transaction(async tx=>{
   const states=new Map<string,State>();
   for(const key of [...new Set(keys)].sort()){
    if(key.length>1024)throw new Error('Limit key too long');
    await tx.$executeRaw`INSERT INTO desktop_limit_state(key) VALUES (${key}) ON CONFLICT DO NOTHING`;
    const rows=await tx.$queryRaw<Array<{data:State}>>`SELECT data FROM desktop_limit_state WHERE key=${key} FOR UPDATE`;
    states.set(key,rows[0].data);
   }
   const result=fn(states);
   for(const [key,data] of states)await tx.$executeRaw`UPDATE desktop_limit_state SET data=${JSON.stringify(data)}::jsonb WHERE key=${key}`;
   return result;
  });
 }
 async checkRequestLimit(input:{key:string;maxRequests:number;windowMs:number;nowMs?:number}):Promise<LimitDecision>{
  if(!Number.isInteger(input.maxRequests)||input.maxRequests<1||input.maxRequests>100000||!Number.isFinite(input.windowMs)||input.windowMs<=0)throw new Error('Invalid request limit');
  return this.mutate(['request:'+input.key],states=>{
   const state=states.get('request:'+input.key)!,now=input.nowMs??Date.now();
   state.timestamps=(state.timestamps??[]).filter(t=>now-t<input.windowMs);
   if(state.timestamps.length>=input.maxRequests)return {allowed:false,code:input.key.startsWith('project:')?'socrates_project_rate_limited':'socrates_rate_limited',remaining:0,retryAfterMs:Math.max(1,input.windowMs-(now-state.timestamps[0]))};
   state.timestamps.push(now);return {allowed:true,code:'allowed'};
  });
 }
 async acquireConcurrent(key:string,maxConcurrent:number):Promise<LimitDecision>{
  if(!Number.isInteger(maxConcurrent)||maxConcurrent<1)throw new Error('Invalid concurrent limit');
  const id=randomUUID();
  const decision=await this.mutate(['concurrent:'+key],states=>{
   const state=states.get('concurrent:'+key)!;state.holds=(state.holds??[]).filter(h=>h.until>Date.now());
   if(state.holds.length>=maxConcurrent)return {allowed:false,code:'socrates_stream_limit_exceeded'} as LimitDecision;
   state.holds.push({id,until:Date.now()+60_000});return {allowed:true,code:'allowed'} as LimitDecision;
  });
  if(decision.allowed)this.held.set(key,[...(this.held.get(key)??[]),id]);return decision;
 }
 async releaseConcurrent(key:string){const ids=this.held.get(key);const id=ids?.shift();if(!id)return;if(!ids?.length)this.held.delete(key);
  await this.mutate(['concurrent:'+key],states=>{const state=states.get('concurrent:'+key)!;state.holds=(state.holds??[]).filter(h=>h.id!==id);});
 }
 private async renew(){for(const [key,ids] of this.held)await this.mutate(['concurrent:'+key],states=>{for(const h of states.get('concurrent:'+key)!.holds??[])if(ids.includes(h.id))h.until=Date.now()+60_000;});}
 checkDailyCost(input:DailyCostLimitInput){return this.checkDailyCosts([input]);}
 async checkDailyCosts(inputs:DailyCostLimitInput[]):Promise<LimitDecision>{
  for(const i of inputs)if(!Number.isFinite(i.addCostUsd)||i.addCostUsd<0||(i.maxDailyCostUsd!=null&&!Number.isFinite(i.maxDailyCostUsd)))throw new Error('Invalid AI cost');
  const limited=inputs.filter(i=>i.maxDailyCostUsd!=null&&i.maxDailyCostUsd>0);
  return this.mutate(limited.map(i=>'cost:'+i.key),states=>{
   const proposed=new Map<string,State>();
   for(const i of limited){const key='cost:'+i.key,day=(i.now??new Date()).toISOString().slice(0,10);const old=proposed.get(key)??states.get(key)!;
    const cost=(old.day===day?(old.cost??0):0)+i.addCostUsd;
    if(cost>i.maxDailyCostUsd!)return {allowed:false,code:'socrates_cost_budget_exceeded',deniedKey:i.key};
    proposed.set(key,{day,cost});
   }
   for(const [key,state] of proposed)states.set(key,state);return {allowed:true,code:'allowed'};
  });
 }
 async close(){clearInterval(this.timer);for(const key of [...this.held.keys()])while(this.held.has(key))await this.releaseConcurrent(key);}
}
