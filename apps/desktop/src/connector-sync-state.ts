import {z} from 'zod';
import {githubCheckpointSchema} from './github-sources.js';
import {slackCheckpointSchema} from './slack-sources.js';
export const syncCheckpointSchema=z.discriminatedUnion('provider',[
 z.object({provider:z.literal('github'),cursor:githubCheckpointSchema}).strict(),
 z.object({provider:z.literal('slack'),cursor:slackCheckpointSchema}).strict()
]);
export type SyncCheckpoint=z.infer<typeof syncCheckpointSchema>;
export const syncTargetSchema=z.object({
 id:z.string().guid(),provider:z.enum(['slack','github','drive']),projectId:z.string().guid(),
 resourceIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,256}$/)).min(1).max(50),teamId:z.string().regex(/^T[A-Z0-9]+$/).optional(),
 enabled:z.boolean(),nextAt:z.number().int().nonnegative(),lastAttemptAt:z.string().datetime().optional(),lastSuccessAt:z.string().datetime().optional(),
 error:z.enum(['source_refresh_failed']).nullable().optional(),
 checkpoint:syncCheckpointSchema.nullable().optional(),checkpointPaused:z.boolean().optional(),historyLimited:z.boolean().optional()
}).strict().refine(target=>!target.checkpoint||target.checkpoint.provider===target.provider,'Checkpoint must match its selected provider');
export type SyncTarget=z.infer<typeof syncTargetSchema>;
export function dueTarget(targets:SyncTarget[],now:number){return targets.filter(t=>(t.checkpoint?!t.checkpointPaused:t.enabled)&&t.nextAt<=now).sort((a,b)=>a.nextAt-b.nextAt)[0];}
export function finishedTarget(target:SyncTarget,ok:boolean,now:number):SyncTarget{
 return {...target,nextAt:now+(ok?target.checkpoint?15000:300000:60000),lastAttemptAt:new Date(now).toISOString(),
  ...(ok&&!target.checkpoint&&!target.historyLimited?{lastSuccessAt:new Date(now).toISOString()}:{}),error:ok?null:'source_refresh_failed'};
}
