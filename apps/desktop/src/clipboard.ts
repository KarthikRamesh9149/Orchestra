import {z} from 'zod';
export const clipboardTextSchema=z.string().max(256*1024);
export function copyPlainText(input:unknown,write:(text:string)=>void){
 write(clipboardTextSchema.parse(input));return {copied:true};
}
