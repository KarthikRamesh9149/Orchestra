import {isDesktop} from './desktop';
export async function copyText(text:string):Promise<void>{
 if(isDesktop()){
  const copy=(window.orchestra as typeof window.orchestra & {copyText?:(text:string)=>Promise<{ok:boolean;error?:{message:string}}>})?.copyText;
  if(!copy)throw new Error('Native clipboard is unavailable');
  const result=await copy(text);if(!result.ok)throw new Error(result.error?.message??'Copy failed');return;
 }
 if(!navigator.clipboard)throw new Error('Clipboard is unavailable');
 await navigator.clipboard.writeText(text);
}
