import { isAbsolute } from "node:path";
import { z } from "zod";

export const runtimeProfileSchema=z.object({
  profile:z.enum(['desktop-local','self-hosted','managed']),
  databaseUrl:z.string().url(),
  host:z.string(),
  storageRoot:z.string().optional(),
  queue:z.enum(['postgres','bullmq']),
  redisUrl:z.string().optional(),
}).superRefine((value,ctx)=>{
  const url=new URL(value.databaseUrl);
  if(!['postgres:','postgresql:'].includes(url.protocol))ctx.addIssue({code:'custom',path:['databaseUrl'],message:'PostgreSQL is required'});
  if(value.profile==='desktop-local'){
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))ctx.addIssue({code:'custom',path:['databaseUrl'],message:'Desktop local database must be loopback'});
    if(!['127.0.0.1','::1'].includes(value.host))ctx.addIssue({code:'custom',path:['host'],message:'Desktop API must bind loopback'});
    if(value.queue!=='postgres')ctx.addIssue({code:'custom',path:['queue'],message:'Desktop jobs must be durable PostgreSQL jobs'});
    if(value.redisUrl)ctx.addIssue({code:'custom',path:['redisUrl'],message:'Desktop local does not use Redis'});
    if(!value.storageRoot||!isAbsolute(value.storageRoot))ctx.addIssue({code:'custom',path:['storageRoot'],message:'Private absolute application storage root required'});
  }else{
    if(value.queue!=='bullmq'||!value.redisUrl)ctx.addIssue({code:'custom',path:['queue'],message:'Server profiles preserve the BullMQ worker and configured Redis'});
  }
});
export type RuntimeProfile=z.infer<typeof runtimeProfileSchema>;

// This is an independent contract. The runtime composition adapter must consume
// it before this becomes a selectable application mode; it never changes
// DEPLOYMENT_ENV or bypasses existing managed-production validation.
export function parseRuntimeProfile(input:unknown):RuntimeProfile{return runtimeProfileSchema.parse(input);}
