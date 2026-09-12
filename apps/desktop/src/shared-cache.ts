import {sharedCachePolicySchema} from '../../../src/desktop/shared-contract.js';

const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const documents=new RegExp(`^/v1/projects/${uuid}/documents(?:/${uuid})?$`);
export function isCacheableSharedRead(path:string){
 const url=new URL(path,'https://cache.invalid');
 return path.startsWith('/v1/')&&path.length<=4096&&url.origin==='https://cache.invalid'&&documents.test(url.pathname);
}
type Entry={body:string;bytes:number;expires:number};

/** Per-window, RAM-only evidence. No auth/bootstrap, chats, downloads or truth decisions. */
export class SharedReadCache{
 private policy=sharedCachePolicySchema.parse(undefined);
 private identity:string|null=null;
 private entries=new Map<string,Entry>();
 private timer:ReturnType<typeof setTimeout>|undefined;
 private served=false;
 private servedDeadline=Infinity;
 constructor(private readonly invalidateView:()=>void=()=>{},private readonly now:()=>number=()=>performance.now()){}
 configure(input:unknown){
  const next=sharedCachePolicySchema.parse(input);
  if(JSON.stringify(next)!==JSON.stringify(this.policy)){this.clear();this.policy=next;}
 }
 bind(identity:string|null){if(identity!==this.identity){this.clear();this.identity=identity;}}
 clear(){
  clearTimeout(this.timer);this.timer=undefined;this.entries.clear();
  const visible=this.served;this.served=false;this.servedDeadline=Infinity;if(visible)this.invalidateView();
 }
 close(){this.clear();this.identity=null;}
 canStore(path:string){return this.policy.enabled&&this.identity!==null&&isCacheableSharedRead(path);}
 get(path:string){
  if(!this.policy.enabled||!this.identity)return null;
  const entry=this.entries.get(path);if(!entry)return null;
  if(entry.expires<=this.now()){this.clear();return null;}
  this.served=true;this.servedDeadline=Math.min(this.servedDeadline,entry.expires);this.schedule();return {body:entry.body,remainingMs:entry.expires-this.now()};
 }
 put(path:string,body:string){
  if(!this.canStore(path)||!this.policy.enabled)return;
  // A replacement must never leave the previous snapshot reachable.
  this.entries.delete(path);const bytes=Buffer.byteLength(body)+Buffer.byteLength(path);
  if(bytes>this.policy.maxBytes){this.schedule();return;}
  let total=[...this.entries.values()].reduce((sum,row)=>sum+row.bytes,0);
  while(this.entries.size&&(total+bytes>this.policy.maxBytes||this.entries.size>=128)){
   const key=this.entries.keys().next().value!;total-=this.entries.get(key)!.bytes;this.entries.delete(key);
  }
  this.entries.set(path,{body,bytes,expires:this.now()+this.policy.ttlSeconds*1000});this.schedule();
 }
 private schedule(){
  clearTimeout(this.timer);this.timer=undefined;if(!this.entries.size&&!this.served)return;
  // Conservatively purge the entire view at the earliest retained evidence expiry.
  const deadline=Math.min(this.servedDeadline,...[...this.entries.values()].map(row=>row.expires));
  this.timer=setTimeout(()=>this.clear(),Math.max(0,deadline-this.now()));this.timer.unref?.();
 }
}
