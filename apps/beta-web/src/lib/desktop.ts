type DesktopResult={ok:boolean;data?:unknown;error?:{code:string;message:string}};
declare global {interface Window {orchestra?:{status:()=>Promise<{state:string;message:string}>;bootstrap:()=>Promise<DesktopResult>;completeOnboarding:()=>Promise<DesktopResult>;downloadDocument?:(projectId:string,documentId:string)=>Promise<DesktopResult>}}}
export async function saveDesktopDocument(projectId:string,documentId:string){const operation=window.orchestra?.downloadDocument;if(!operation)throw new Error('Native document save is unavailable');const result=await operation(projectId,documentId);if(!result.ok)throw new Error(result.error?.message??'The original could not be saved');return result.data as {cancelled:boolean};}
export function isDesktop(){return typeof window!=='undefined'&&!!window.orchestra;}
export async function desktopBootstrap<T>():Promise<T>{
 const bridge=window.orchestra;if(!bridge)throw new Error('Desktop bridge unavailable');
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){const status=await bridge.status();if(status.state==='ready'){const result=await bridge.bootstrap();if(!result.ok)throw new Error(result.error?.message??'Local bootstrap failed');return result.data as T;}if(status.state==='failed')throw new Error(status.message);await new Promise(resolve=>setTimeout(resolve,150));}
 throw new Error('Local engine startup timed out. Reopen Orchestra to retry.');
}
