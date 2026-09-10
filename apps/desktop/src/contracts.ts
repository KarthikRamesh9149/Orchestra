import { z } from 'zod';

export const commandSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('workspace.list')}).strict(),
 z.object({operation:z.literal('workspace.create'),name:z.string().trim().min(1).max(100)}).strict(),
 z.object({operation:z.literal('workspace.select'),projectId:z.string().uuid()}).strict(),
 z.object({operation:z.literal('socrates.ask'),requestId:z.string().uuid(),projectId:z.string().uuid(),question:z.string().trim().min(1).max(10000),sessionId:z.string().uuid().optional()}).strict(),
 z.object({operation:z.literal('socrates.cancel'),requestId:z.string().uuid()}).strict(),
 z.object({operation:z.literal('evidence.upload'),projectId:z.string().uuid(),selectionId:z.string().uuid()}).strict()
]);
export type Command=z.infer<typeof commandSchema>;
export type RuntimeStatus={state:'starting'|'ready'|'failed'|'stopping';message:string};
export type OperationResult={ok:true;data:unknown}|{ok:false;error:{code:string;message:string}};
export interface DesktopBridge {
 status():Promise<RuntimeStatus>;
 workspaces:{list():Promise<OperationResult>;create(name:string):Promise<OperationResult>;select(projectId:string):Promise<OperationResult>};
 chooseEvidence():Promise<OperationResult>;
 uploadEvidence(projectId:string,selectionId:string):Promise<OperationResult>;
 ask(input:{requestId:string;projectId:string;question:string;sessionId?:string}):Promise<OperationResult>;
 cancel(requestId:string):Promise<OperationResult>;
 onDelta(callback:(event:{requestId:string;delta:string})=>void):()=>void;
}
export const APP_ORIGIN='orchestra://app';
export function isTrustedFrame(url:string,topLevel:boolean){try{const value=new URL(url);return topLevel&&value.protocol==='orchestra:'&&value.host==='app'&&!value.username&&!value.password;}catch{return false;}}
