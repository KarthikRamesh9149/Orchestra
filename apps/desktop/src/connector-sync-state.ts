import {z} from 'zod';
export const syncTargetSchema=z.object({
 id:z.string().uuid(),provider:z.enum(['slack','github','drive']),projectId:z.string().uuid(),
 resourceIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,256}$/)).min(1).max(50),teamId:z.string().regex(/^T[A-Z0-9]+$/).optional(),
 enabled:z.boolean(),nextAt:z.number().int().nonnegative(),lastAttemptAt:z.string().datetime().optional(),lastSuccessAt:z.string().datetime().optional(),
 error:z.enum(['source_refresh_failed']).nullable().optional()
}).strict();
export type SyncTarget=z.infer<typeof syncTargetSchema>;
export function dueTarget(targets:SyncTarget[],now:number){return targets.filter(t=>t.enabled&&t.nextAt<=now).sort((a,b)=>a.nextAt-b.nextAt)[0];}
export function finishedTarget(target:SyncTarget,ok:boolean,now:number):SyncTarget{
 return {...target,nextAt:now+(ok?300000:60000),lastAttemptAt:new Date(now).toISOString(),...(ok?{lastSuccessAt:new Date(now).toISOString()}:{}),error:ok?null:'source_refresh_failed'};
}
