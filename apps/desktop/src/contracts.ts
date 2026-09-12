import { z } from 'zod';

export const commandSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('local.bootstrap')}).strict(),
 z.object({operation:z.literal('local.onboard')}).strict(),
 z.object({operation:z.literal('workspace.list')}).strict(),
 z.object({operation:z.literal('workspace.create'),name:z.string().trim().min(1).max(100)}).strict(),
 z.object({operation:z.literal('workspace.select'),projectId:z.string().uuid()}).strict(),
 z.object({operation:z.literal('socrates.ask'),requestId:z.string().uuid(),projectId:z.string().uuid(),question:z.string().trim().min(1).max(10000),sessionId:z.string().uuid().optional(),selectedSources:z.array(z.enum(['documents','google_drive','slack','communications','timeline','live_doc','socrates_history','team','subscriptions','github','notion','vscode'])).min(1).max(12).optional()}).strict(),
 z.object({operation:z.literal('socrates.cancel'),requestId:z.string().uuid()}).strict(),
 z.object({operation:z.literal('evidence.upload'),projectId:z.string().uuid(),selectionId:z.string().uuid()}).strict()
]);
export type Command=z.infer<typeof commandSchema>;
export type RuntimeStatus={state:'starting'|'ready'|'failed'|'stopping';message:string};
export type OperationResult={ok:true;data:unknown}|{ok:false;error:{code:string;message:string}};
export interface DesktopBridge {
 shared:{list():Promise<OperationResult>;connect(input:{name:string;origin:string}):Promise<OperationResult>;open(id:string):Promise<OperationResult>;remove(id:string):Promise<OperationResult>};
 sync:{inspect():Promise<OperationResult>;update(input:{id:string;action:'enable'|'pause'|'remove'|'refresh'}):Promise<OperationResult>;cancel():Promise<OperationResult>};
 drive:{inspect():Promise<OperationResult>;configure():Promise<OperationResult>;connect():Promise<OperationResult>;cancel():Promise<OperationResult>;revoke():Promise<OperationResult>;importFiles(projectId:string):Promise<OperationResult>};
 github:{inspect():Promise<OperationResult>;connect():Promise<OperationResult>;cancel():Promise<OperationResult>;repositories():Promise<OperationResult>;disconnect():Promise<OperationResult>;importRepository(input:{projectId:string;repositoryId:number}):Promise<OperationResult>};
 slack:{inspect():Promise<OperationResult>;connect():Promise<OperationResult>;cancel():Promise<OperationResult>;revoke():Promise<OperationResult>;channels():Promise<OperationResult>;importChannel(input:{projectId:string;channelId:string}):Promise<OperationResult>};
 mcp:{inspect():Promise<OperationResult>;pair(input:unknown):Promise<OperationResult>;revoke(id:string):Promise<OperationResult>};
 ai:{inspect():Promise<OperationResult>;configure(preferences:unknown):Promise<OperationResult>;revoke():Promise<OperationResult>};
 bootstrap():Promise<OperationResult>;
 completeOnboarding():Promise<OperationResult>;
 copyText(text:string):Promise<OperationResult>;
 downloadDocument(projectId:string,documentId:string):Promise<OperationResult>;
 downloadPreflight(projectId:string,packId:string):Promise<OperationResult>;
 status():Promise<RuntimeStatus>;
 workspaces:{list():Promise<OperationResult>;create(name:string):Promise<OperationResult>;select(projectId:string):Promise<OperationResult>};
 chooseEvidence():Promise<OperationResult>;
 chooseFolder():Promise<OperationResult>;
 chooseRepository():Promise<OperationResult>;
 uploadEvidence(projectId:string,selectionId:string):Promise<OperationResult>;
 ask(input:{requestId:string;projectId:string;question:string;sessionId?:string;selectedSources?:string[]}):Promise<OperationResult>;
 cancel(requestId:string):Promise<OperationResult>;
 onDelta(callback:(event:{requestId:string;delta:string})=>void):()=>void;
}
export const APP_ORIGIN='orchestra://app';
export function isTrustedFrame(url:string,topLevel:boolean){try{const value=new URL(url);return topLevel&&value.protocol==='orchestra:'&&value.host==='app'&&!value.username&&!value.password;}catch{return false;}}
