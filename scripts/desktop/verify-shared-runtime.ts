import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import {SharedHttp,inspectSharedServer,type SharedGrant} from '../../apps/desktop/src/shared-http.js';

const root=resolve('.desktop/self-host-v1-qualification'),origin='https://localhost:4446';
const account=JSON.parse(await readFile(join(root,'bootstrap-account.json'),'utf8')) as {email:string;password:string};
assert.equal(account.email,'owner@qualification.invalid','This harness accepts only its synthetic fixture');
const manifest=await inspectSharedServer(origin),passed:string[]=[];
const make=()=>{let grant:SharedGrant|null=null;const store={read:async()=>grant,write:async(value:SharedGrant|null)=>{grant=value;}};return {client:new SharedHttp({id:randomUUID(),name:'Synthetic shared server',origin,serverId:manifest.serverId},store),store};};
const owner=make(),developer=make();
async function call(client:SharedHttp,path:string,method='GET',body?:unknown,expected=200){
 const result=await client.handle(new Request('orchestra://app'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
 const payload=await result.json() as {data:any;error?:{code:string;message:string}};
 assert.equal(result.status,expected,`${method} ${path}: ${payload.error?.code??'unexpected status'}`);
 assert.equal(result.headers.get('set-cookie'),null);assert.equal(result.headers.get('cache-control'),'no-store');
 return payload.data;
}
const record=(name:string)=>{passed.push(name);console.log('PASS',name);};
let projectId:string|undefined;
try{
 const login=await call(owner.client,'/v1/auth/login','POST',{...account,sessionMode:'browser'});assert(login.user.id);assert(!('accessToken' in login));record('real shared bearer login with grants hidden from renderer');
 const project=await call(owner.client,'/v1/projects','POST',{name:'Synthetic Step 6 '+randomUUID().slice(0,8)});projectId=project.id;
 await call(owner.client,'/v1/me/workspaces/switch','POST',{projectId});
 const boot=await call(owner.client,'/v1/auth/bootstrap','POST',{sessionMode:'browser'});assert(boot.workspaces.some((row:any)=>row.projectId===projectId&&row.current));record('authoritative workspace switch and bootstrap');
 const name='Synthetic renamed '+randomUUID().slice(0,8);await call(owner.client,`/v1/projects/${projectId}/settings`,'PATCH',{name});assert.equal((await call(owner.client,`/v1/projects/${projectId}/settings`)).name,name);record('manager mutation survives a fresh server read');
 const source='Synthetic Step 6 acceptance: launch is 21 October 2026. Team decisions require approval. This is disposable test evidence, not customer data.';
 const uploaded=await call(owner.client,`/v1/projects/${projectId}/documents/upload`,'POST',{kind:'reference',title:'Synthetic shared acceptance',pastedText:source,visibility:'internal'});
 const fileUrl=`orchestra://app/v1/projects/${projectId}/documents/${uploaded.documentId}/file`;
 const deadline=Date.now()+30000;
 let original=await owner.client.handle(new Request(fileUrl));
 while(original.status===409&&Date.now()<deadline){
  await original.body?.cancel();
  await new Promise(resolve=>setTimeout(resolve,250));
  original=await owner.client.handle(new Request(fileUrl));
 }
 assert.equal(original.status,200,'Uploaded file must become available after bounded processing');assert.equal(await original.text(),source);record('authorized source upload and exact-byte download');
 const email=`developer-${randomUUID().slice(0,8)}@qualification.invalid`,password=randomBytes(24).toString('hex');
 const invite=await call(owner.client,`/v1/projects/${projectId}/join-codes`,'POST',{projectRole:'dev',invitedEmail:email});assert(invite.code);assert.notEqual(invite.emailDeliveryStatus,'sent');
 const joined=await call(developer.client,'/v1/auth/invitations/redeem','POST',{accountType:'new',email,password,displayName:'Synthetic developer',code:invite.code,sessionMode:'browser'});assert(joined.user.id);record('email-bound invitation redeem without invented email delivery');
 await call(developer.client,'/v1/me/workspaces/switch','POST',{projectId});
 assert.equal((await call(developer.client,`/v1/projects/${projectId}/settings`)).name,name);
 await call(developer.client,`/v1/projects/${projectId}/settings`,'PATCH',{name:'Unauthorized change'},403);record('separate developer sees shared state but cannot rename');
 const privateChat=await call(owner.client,`/v1/projects/${projectId}/socrates/sessions`,'POST',{pageContext:'dashboard_general'});
 await call(owner.client,`/v1/projects/${projectId}/socrates/sessions/${privateChat.id}/messages`);
 const denied=await developer.client.handle(new Request(`orchestra://app/v1/projects/${projectId}/socrates/sessions/${privateChat.id}/messages`));assert([403,404].includes(denied.status));record('owner can read private chat history; another project member cannot');
 const before=await owner.store.read();assert(before);const expired=new SharedHttp({id:randomUUID(),name:'Restarted client',origin,serverId:manifest.serverId},owner.store);
 await call(expired,'/v1/auth/bootstrap','POST',{sessionMode:'browser'});record('saved grant resumes through compatibility validation');expired.close();
 const config=JSON.parse(await readFile(join(root,'application.json'),'utf8')) as {JWT_ACCESS_SECRET:string};
 const [header,encoded]=before.accessToken.split('.'),claims=JSON.parse(Buffer.from(encoded!,'base64url').toString());claims.exp=Math.floor(Date.now()/1000)-10;
 const unsigned=header+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
 await owner.store.write({...before,accessToken:unsigned+'.'+createHmac('sha256',config.JWT_ACCESS_SECRET).update(unsigned).digest('base64url')});
 await call(owner.client,'/v1/auth/bootstrap','POST',{sessionMode:'browser'});assert.notEqual((await owner.store.read())?.refreshToken,before.refreshToken);record('expired access session rotates its protected refresh grant');
 await call(developer.client,'/v1/me/sessions/revoke-all','POST',{includeCurrent:false});assert(await developer.store.read());
 await call(developer.client,'/v1/auth/bootstrap','POST',{});record('revoke other sessions preserves the current authorized login');
 await call(developer.client,'/v1/auth/logout','POST',{});assert.equal(await developer.store.read(),null);await call(developer.client,'/v1/auth/bootstrap','POST',{sessionMode:'browser'},401);record('logout removes the isolated grant and prevents silent relogin');
 const current=await owner.store.read();assert(current);
 const [logoutHeader,logoutEncoded]=current.accessToken.split('.'),logoutClaims=JSON.parse(Buffer.from(logoutEncoded!,'base64url').toString());logoutClaims.exp=Math.floor(Date.now()/1000)-10;
 const logoutUnsigned=logoutHeader+'.'+Buffer.from(JSON.stringify(logoutClaims)).toString('base64url');
 await owner.store.write({...current,accessToken:logoutUnsigned+'.'+createHmac('sha256',config.JWT_ACCESS_SECRET).update(logoutUnsigned).digest('base64url')});
 await call(owner.client,'/v1/auth/logout','POST',{});assert.equal(await owner.store.read(),null);record('expired access logout refreshes then revokes the authoritative session');
 await writeFile(resolve('.desktop/step6-shared-runtime.json'),JSON.stringify({mode:'single-machine-real-HTTPS-and-PostgreSQL',origin,serverId:manifest.serverId,projectId,passed,twoComputerGate:'pending',aiCalls:0},null,2));
}finally{owner.client.close();developer.client.close();}
