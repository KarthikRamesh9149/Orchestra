/** OS browser handoff only, never load remote content into the renderer. */
export function externalHttpsUrl(input:string):string|null {
 if(input.length>8192||/[\u0000-\u0020\u007f]/.test(input))return null;
 try{const url=new URL(input);if(url.protocol!=='https:'||url.username||url.password||!url.hostname)return null;return url.href;}catch{return null;}
}
export async function openConfirmedExternal(input:string,confirm:(url:string)=>Promise<boolean>,open:(url:string)=>Promise<unknown>){
 const url=externalHttpsUrl(input);if(!url)return {opened:false};
 if(!await confirm(url))return {opened:false};await open(url);return {opened:true};
}
