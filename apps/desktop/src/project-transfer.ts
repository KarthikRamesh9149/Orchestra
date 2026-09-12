import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {nativeArchiveLimit,transferCommit,type TransferAction} from '../../../src/desktop/transfer-contract.js';
type Dependencies={send(action:TransferAction,projectId:string,body:unknown):Promise<any>;choose():Promise<Buffer|undefined>;passphrase(exporting:boolean):Promise<string|undefined>;save(bytes:Buffer):Promise<unknown>;confirm(projectId:string):Promise<boolean>};
/** Main-process only. A product page sees neither paths, archives nor passwords. */
export class NativeProjectTransfer{
 private pending?:{id:string;projectId:string;archiveBase64:string;passphrase:string;digest:string;expires:number};
 private busy=false;private disposed=false;
 private timer?:NodeJS.Timeout;
 constructor(private readonly deps:Dependencies){}
 close(){this.disposed=true;this.clear();}
 private clear(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.pending=undefined;}
 private async exclusive<T>(run:()=>Promise<T>){if(this.disposed||this.busy)throw new Error('Finish the current transfer or reopen this window.');this.busy=true;try{return await run();}finally{this.busy=false;}}
 async export(projectId:string){return this.exclusive(async()=>{
  z.string().uuid().parse(projectId);const passphrase=await this.deps.passphrase(true);if(!passphrase)return {cancelled:true};
  const result=await this.deps.send('export',projectId,{passphrase});
  const base64=z.string().max(Math.ceil(nativeArchiveLimit/3)*4).parse(result.archiveBase64),bytes=Buffer.from(base64,'base64');
  if(bytes.length>nativeArchiveLimit||bytes.toString('base64')!==base64)throw new Error('Transfer exceeds the supported archive size.');
  if(this.disposed)throw new Error('Window closed');return this.deps.save(bytes);
 });}
 async preview(projectId:string){return this.exclusive(async()=>{
  z.string().uuid().parse(projectId);this.clear();
  const bytes=await this.deps.choose();if(!bytes)return {cancelled:true};if(bytes.length>nativeArchiveLimit)throw new Error('Choose an archive up to 16 MiB.');
  const passphrase=await this.deps.passphrase(false);if(!passphrase)return {cancelled:true};
  const archiveBase64=bytes.toString('base64'),result=await this.deps.send('preview',projectId,{archiveBase64,passphrase});
  const digest=z.string().regex(/^[a-f0-9]{64}$/).parse(result.digest);
  if(this.disposed)throw new Error('Window closed');
  const id=randomUUID();this.pending={id,projectId,archiveBase64,passphrase,digest,expires:Date.now()+300000};
  this.timer=setTimeout(()=>this.clear(),300000);this.timer.unref();
  // Explicit projection: even a remote response cannot put credentials into the page.
  return {previewId:id,source:result.source,actors:result.actors,targetIdentities:result.targetIdentities,counts:result.counts,exclusions:result.exclusions};
 });}
 async commit(value:unknown){return this.exclusive(async()=>{
  const input=transferCommit.parse(value),pending=this.pending;
  if(!pending||pending.id!==input.previewId||pending.projectId!==input.projectId||pending.expires<=Date.now())throw new Error('Preview expired or workspace changed. Select the archive again.');
  if(!await this.deps.confirm(input.projectId))return {cancelled:true};
  if(this.disposed||pending!==this.pending||pending.expires<=Date.now())throw new Error('Preview expired.');
  const result=await this.deps.send('import',input.projectId,{archiveBase64:pending.archiveBase64,passphrase:pending.passphrase,digest:pending.digest,identityMap:input.identityMap,acknowledgeHistoricalTruth:true});
  this.clear();return {projectId:result.projectId,replayed:result.replayed};
 });}
}
