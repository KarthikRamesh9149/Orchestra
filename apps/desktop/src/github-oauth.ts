import {z} from 'zod';
import {setTimeout as delay} from 'node:timers/promises';

// Public desktop-only registration. No app private key or client secret ships.
export const GITHUB_DESKTOP_CLIENT_ID='Iv23liJuGtrnLcxJudju';
export const GITHUB_DESKTOP_APP_ID=4916325;
export const githubCredentialSchema=z.object({
 accessToken:z.string().regex(/^ghu_[A-Za-z0-9]+$/).max(512),
 refreshToken:z.string().regex(/^ghr_[A-Za-z0-9]+$/).max(512),
 expiresAt:z.number().int().positive(),refreshExpiresAt:z.number().int().positive()
}).strict();
export type GitHubCredential=z.infer<typeof githubCredentialSchema>;
const tokenSchema=z.object({access_token:githubCredentialSchema.shape.accessToken,refresh_token:githubCredentialSchema.shape.refreshToken,expires_in:z.number().int().positive().max(28800),refresh_token_expires_in:z.number().int().positive().max(15897600),scope:z.literal(''),token_type:z.literal('bearer')});
const deviceSchema=z.object({device_code:z.string().regex(/^[A-Za-z0-9]{40}$/),user_code:z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),verification_uri:z.literal('https://github.com/login/device'),expires_in:z.number().int().positive().max(900),interval:z.number().int().positive().max(60)});

async function boundedJson(response:Response):Promise<unknown>{
 if(!response.ok){await response.body?.cancel();throw new Error(response.status===429||response.status===403?'GitHub access or rate limit rejected the request.':'GitHub request failed.');}
 if(!response.body)throw new Error('Empty GitHub response');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error('GitHub response exceeds limit');chunks.push(value);}}
 finally{await reader.cancel();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Invalid GitHub response');}
}
async function oauth(path:'device/code'|'oauth/access_token',params:URLSearchParams,fetcher:typeof fetch,signal?:AbortSignal){
 return boundedJson(await fetcher(`https://github.com/login/${path}`,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:params,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)}));
}
function credential(value:unknown):GitHubCredential{
 const token=tokenSchema.parse(value);const now=Date.now();
 return githubCredentialSchema.parse({accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:now+1000*token.expires_in,refreshExpiresAt:now+1000*token.refresh_token_expires_in});
}
/** Display only the user code in native UI. The device code never leaves main. */
export async function connectGitHub(showCode:(code:string)=>Promise<void>,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<GitHubCredential>{
 const device=deviceSchema.parse(await oauth('device/code',new URLSearchParams({client_id:GITHUB_DESKTOP_CLIENT_ID}),fetcher,signal));
 const deadline=AbortSignal.timeout(Math.min(device.expires_in*1000,180000));
 const bounded=signal?AbortSignal.any([signal,deadline]):deadline;
 // Caller must present the real device code and fixed GitHub verification URL,
 // not auto-consent to a code supplied by a webpage or untrusted repository.
 await showCode(device.user_code);bounded.throwIfAborted();let interval=device.interval;
 for(;;){
  await delay(interval*1000,undefined,{signal:bounded});
  const payload=await oauth('oauth/access_token',new URLSearchParams({client_id:GITHUB_DESKTOP_CLIENT_ID,device_code:device.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'}),fetcher,bounded);
  const failure=z.object({error:z.string(),interval:z.number().int().positive().max(120).optional()}).safeParse(payload);
  if(failure.success){
   if(failure.data.error==='authorization_pending')continue;
   if(failure.data.error==='slow_down'){interval=Math.max(interval+5,failure.data.interval??0);continue;}
   throw new Error('GitHub authorization was declined, expired or unavailable.');
  }
  return credential(payload);
 }
}
/** Caller serializes rotation with durable storage before the next API read. */
export async function refreshGitHub(input:GitHubCredential,fetcher:typeof fetch=fetch,signal?:AbortSignal){
 const value=githubCredentialSchema.parse(input);
 if(value.expiresAt>Date.now()+60000)return value;
 if(value.refreshExpiresAt<=Date.now())throw new Error('GitHub authorization expired. Reconnect.');
 return credential(await oauth('oauth/access_token',new URLSearchParams({client_id:GITHUB_DESKTOP_CLIENT_ID,grant_type:'refresh_token',refresh_token:value.refreshToken}),fetcher,signal));
}
/** API paths come exclusively from native adapters, never arbitrary UI URLs. */
export async function githubRead(path:string,token:string,fetcher:typeof fetch=fetch):Promise<unknown>{
 const inventory=/^\/user\/installations(?:\/[1-9][0-9]*\/repositories)?\?per_page=100&page=[1-9][0-9]*$/;
 const evidence=/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:pulls\?state=all&sort=updated&direction=desc|commits\?)&per_page=100&page=[1-9][0-9]*$/;
 if((!inventory.test(path)&&!evidence.test(path))||path.split('/').some(part=>part==='.'||part==='..'))throw new Error('Unapproved GitHub API path');
 return boundedJson(await fetcher(`https://api.github.com${path}`,{headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},redirect:'error',signal:AbortSignal.timeout(15000)}));
}
const installationSchema=z.object({id:z.number().int().positive(),app_id:z.number().int().positive(),permissions:z.record(z.string()),suspended_at:z.string().nullable(),account:z.object({login:z.string().max(100)})});
export const githubRepositorySchema=z.object({id:z.number().int().positive(),full_name:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),private:z.boolean(),default_branch:z.string().min(1).max(255)});
export async function listGitHubRepositories(input:GitHubCredential,fetcher:typeof fetch=fetch){
 const value=githubCredentialSchema.parse(input);const installations:z.infer<typeof installationSchema>[]=[];
 for(let page=1;;page++){
  if(page>10)throw new Error('GitHub installation inventory exceeds limit');
  const response=z.object({total_count:z.number().int().nonnegative().max(1000),installations:z.array(installationSchema).max(100)}).parse(await githubRead(`/user/installations?per_page=100&page=${page}`,value.accessToken,fetcher));
  installations.push(...response.installations);
  if(installations.length>=response.total_count)break;
  if(!response.installations.length)throw new Error('GitHub returned incomplete installation inventory');
 }
 const result:Array<z.infer<typeof githubRepositorySchema>&{installationId:number}>=[];
 for(const installation of installations.filter(i=>i.app_id===GITHUB_DESKTOP_APP_ID&&i.suspended_at===null)){
  if(Object.values(installation.permissions).some(p=>p!=='read')||installation.permissions.contents!=='read')throw new Error('Desktop GitHub requires read-only installation permissions.');
  let seen=0;
  for(let page=1;;page++){
   if(page>10||result.length>1000)throw new Error('GitHub repository inventory exceeds limit');
   const response=z.object({total_count:z.number().int().nonnegative().max(1000),repositories:z.array(githubRepositorySchema).max(100)}).parse(await githubRead(`/user/installations/${installation.id}/repositories?per_page=100&page=${page}`,value.accessToken,fetcher));
   result.push(...response.repositories.map(repo=>({...repo,installationId:installation.id})));seen+=response.repositories.length;
   if(seen>=response.total_count)break;
   if(!response.repositories.length)throw new Error('GitHub returned incomplete repository inventory');
  }
 }
 return result;
}
