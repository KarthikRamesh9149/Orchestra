type DesktopResult={ok:boolean;data?:unknown;error?:{code:string;message:string}};
export type DesktopAiProvider='openai'|'anthropic'|'google'|'openai-compatible';
export type DesktopAiPreferences={provider?:DesktopAiProvider;baseUrl?:string;generationModel:string;embeddingProvider?:'none'|'openai'|'openai-compatible';embeddingBaseUrl?:string;embeddingModel:string;embeddingDimensions:1536;maxRequestsPerDay:number;maxOutputTokens:number};
export type DesktopAiState={configured:boolean;preferences:DesktopAiPreferences|null;semanticSearchAvailable?:boolean|null;semanticSearchReason?:'not_configured'|'embedding_reindex_required'|'runtime_unavailable'|null};
type DesktopAiBridge={inspect:()=>Promise<DesktopResult>;importKey:(input:{target:'generation'|'embedding';preferences:DesktopAiPreferences})=>Promise<DesktopResult>;test:(preferences:DesktopAiPreferences)=>Promise<DesktopResult>;discardDraft:(target?:'generation'|'embedding')=>Promise<DesktopResult>;configure:(preferences:DesktopAiPreferences)=>Promise<DesktopResult>;revoke:()=>Promise<DesktopResult>};
export type SharedServer={id:string;name:string;origin:string;serverId:string};
declare global {interface Window {
 orchestraShared?:{connection:SharedServer;close:()=>Promise<void>;copyText:(text:string)=>Promise<DesktopResult>;isOffline?:()=>boolean;onOfflineChange?:(notify:()=>void)=>()=>void};
 orchestra?:{shared?:{list:()=>Promise<DesktopResult>;connect:(input:{name:string;origin:string})=>Promise<DesktopResult>;open:(id:string)=>Promise<DesktopResult>;remove:(id:string)=>Promise<DesktopResult>};mcp?:{inspect:()=>Promise<DesktopResult>;pair:(input:unknown)=>Promise<DesktopResult>;revoke:(id:string)=>Promise<DesktopResult>};ai?:DesktopAiBridge;status:()=>Promise<{state:string;message:string}>;bootstrap:()=>Promise<DesktopResult>;completeOnboarding:()=>Promise<DesktopResult>;downloadDocument?:(projectId:string,documentId:string)=>Promise<DesktopResult>}
}}
export async function saveDesktopDocument(projectId:string,documentId:string){const operation=window.orchestra?.downloadDocument;if(!operation)throw new Error('Native document save is unavailable');const result=await operation(projectId,documentId);if(!result.ok)throw new Error(result.error?.message??'The original could not be saved');return result.data as {cancelled:boolean};}
export function isDesktop(){return typeof window!=='undefined'&&!!window.orchestra;}
export function isSharedDesktop(){return typeof window!=='undefined'&&!!window.orchestraShared;}
export async function desktopBootstrap<T>():Promise<T>{
 const bridge=window.orchestra;if(!bridge)throw new Error('Desktop bridge unavailable');
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){const status=await bridge.status();if(status.state==='ready'){const result=await bridge.bootstrap();if(!result.ok)throw new Error(result.error?.message??'Local bootstrap failed');return result.data as T;}if(status.state==='failed')throw new Error(status.message);await new Promise(resolve=>setTimeout(resolve,150));}
 throw new Error('Local engine startup timed out. Reopen Orchestra to retry.');
}
