import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import type {Command,OperationResult,RuntimeStatus} from './contracts.js';
import type {Vault} from './vault.js';
import type {ProtectedSettings} from './protected-settings.js';
import type {DesktopSlackBatch,DesktopSlackDisconnect} from '../../../src/desktop/slack-contract.js';

export class HostClient {
 private authority?:{port:number;token:string;bearer:string};
 credentials(){return this.status.state==='ready'?this.authority:undefined;}
 private child?:ChildProcess;
 private pending=new Map<string,{resolve:(value:OperationResult)=>void;timer:NodeJS.Timeout}>();
 status:RuntimeStatus={state:'starting',message:'Starting private local runtime'};
 constructor(private readonly delta:(value:{requestId:string;delta:string})=>void){}
 start(node:string,entry:string,config:{root:string;bundle:string;vault:Vault;ai?:NonNullable<ProtectedSettings['ai']>}){
  if(this.child)throw new Error('Runtime already started');
  const env:NodeJS.ProcessEnv={PATH:'',TMPDIR:process.env.TMPDIR??'',SystemRoot:process.env.SystemRoot??'',NODE_ENV:'production'};
  const child=this.child=spawn(node,[entry],{env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  child.on('message',(message:unknown)=>{
   if(!message||typeof message!=='object')return;
   const event=message as Record<string,unknown>;
   if(event.type==='authority')this.authority=event.value as typeof this.authority;
   if(event.type==='ready')this.status={state:'ready',message:'Local runtime ready'};
   if(event.type==='failed')this.fail();
   if(event.type==='result'&&typeof event.id==='string'){
    const pending=this.pending.get(event.id);if(pending){clearTimeout(pending.timer);this.pending.delete(event.id);pending.resolve(event.result as OperationResult);}
   }
   if(event.type==='delta'&&typeof event.requestId==='string'&&typeof event.delta==='string')this.delta({requestId:event.requestId,delta:event.delta});
  });
  child.once('error',()=>this.fail());child.once('exit',()=>{this.child=undefined;this.fail();});
  child.send({type:'initialize',config});
 }
 private fail(){
  this.authority=undefined;
  if(this.status.state!=='stopping')this.status={state:'failed',message:'Local runtime stopped. Quit and reopen Orchestra to recover.'};
  for(const value of this.pending.values()){clearTimeout(value.timer);value.resolve({ok:false,error:{code:'runtime_unavailable',message:this.status.message}});}this.pending.clear();
 }
 request(command:Command|DesktopSlackBatch|DesktopSlackDisconnect,selection?:{fileName:string;contentType:string;base64:string}):Promise<OperationResult>{
  if(this.status.state!=='ready'||!this.child?.connected)return Promise.resolve({ok:false,error:{code:'runtime_unavailable',message:this.status.message}});
  if(this.pending.size>=16)return Promise.resolve({ok:false,error:{code:'busy',message:'Too many pending operations'}});
  const id=randomUUID();
  return new Promise(resolve=>{
   const timer=setTimeout(()=>{this.pending.delete(id);resolve({ok:false,error:{code:'operation_timeout',message:'Operation timed out; reload before retrying a mutation.'}});},120000);
   this.pending.set(id,{resolve,timer});this.child!.send({type:'command',id,command,selection},error=>{if(error){clearTimeout(timer);this.pending.delete(id);resolve({ok:false,error:{code:'runtime_unavailable',message:'Runtime communication failed'}});}});
  });
 }
 async close(){
  this.status={state:'stopping',message:'Saving and stopping the local runtime'};this.fail();
  const child=this.child;if(!child)return;
  await new Promise<void>(resolve=>{child.once('exit',()=>{clearTimeout(timer);resolve();});const timer=setTimeout(()=>{child.disconnect();resolve();},30000);if(child.connected)child.send({type:'shutdown'});else resolve();});
 }
}
