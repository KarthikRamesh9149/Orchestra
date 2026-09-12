import {z} from 'zod';
import {startOAuthCallback} from './oauth-loopback.js';
// Public Desktop client identifier. Never ship a confidential web client secret.
export const DRIVE_DESKTOP_CLIENT_ID='47292651645-lml2gbsh76gg4d2b55h8sdl1nu9safl5.apps.googleusercontent.com';
export const DRIVE_FILE_SCOPE='https://www.googleapis.com/auth/drive.file';
export const driveClientSchema=z.object({clientId:z.string().regex(/^[A-Za-z0-9_-]{1,200}\.apps\.googleusercontent\.com$/),clientSecret:z.string().min(10).max(512).regex(/^[\x21-\x7e]+$/)}).strict();
export function parseDriveClient(json:string){
 if(Buffer.byteLength(json)>32768)throw new Error('Google client configuration is too large');
 const config=z.object({installed:z.object({client_id:z.string(),client_secret:z.string()})}).strict().parse(JSON.parse(json));
 return driveClientSchema.parse({clientId:config.installed.client_id,clientSecret:config.installed.client_secret});
}
export const driveCredentialSchema=z.object({client:driveClientSchema.optional(),accessToken:z.string().min(10).max(4096),refreshToken:z.string().min(10).max(4096),expiresAt:z.number().int().positive(),fileIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,150}$/)).min(1).max(50),scope:z.literal(DRIVE_FILE_SCOPE)}).strict();
export type DriveCredential=z.infer<typeof driveCredentialSchema>;
export class DriveAuthorizationError extends Error {
 constructor(readonly reason:'callback'|'exchange'|'configuration'|'grant'){
  super({callback:'Google did not return to this Mac before sign-in expired. Retry and allow the local callback in your browser.',exchange:'Google received the authorization but rejected the desktop token exchange. Check the desktop client registration.',configuration:'Google requires additional desktop client configuration. No connection was saved.',grant:'Google did not grant durable access to the selected files. Retry the file selection.'}[reason]);
 }
}
const tokenSchema=z.object({access_token:z.string().min(10).max(4096),refresh_token:z.string().min(10).max(4096).optional(),expires_in:z.number().int().min(1).max(86400),token_type:z.literal('Bearer'),scope:z.string().max(2048).optional()});
export async function boundedGoogleBody(response:Response,limit=2*1024*1024){
 if(!response.ok){await response.body?.cancel();throw new Error(response.status===429?'Google rate limit reached; retry later.':'Google rejected the request; check file access or reconnect.');}
 if(!response.body)throw new Error('Empty Google response');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Google response exceeds limit');chunks.push(value);}}
 finally{await reader.cancel();}
 return Buffer.concat(chunks);
}
async function tokenRequest(params:URLSearchParams,fetcher:typeof fetch,signal?:AbortSignal){
 const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:params,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 if(!response.ok){
  // Classify a bounded provider error; never expose descriptions, codes or tokens.
  const body=await boundedGoogleBody(new Response(response.body),32768).then(bytes=>JSON.parse(bytes.toString('utf8'))).catch(()=>null);
  throw new DriveAuthorizationError(body?.error==='invalid_client'||body?.error_description==='client_secret is missing.'?'configuration':'exchange');
 }
 const value=tokenSchema.parse(JSON.parse((await boundedGoogleBody(response,32768)).toString('utf8')));
 if(value.scope!==undefined&&value.scope!==DRIVE_FILE_SCOPE)throw new Error('Unexpected Google permissions; only selected-file access is allowed');
 return value;
}
export async function connectDrive(openBrowser:(url:string)=>Promise<void>,signal?:AbortSignal,fetcher:typeof fetch=fetch,configuration?:z.infer<typeof driveClientSchema>):Promise<DriveCredential>{
 const client=configuration?driveClientSchema.parse(configuration):undefined;
 const clientId=client?.clientId??DRIVE_DESKTOP_CLIENT_ID;
 const callback=await startOAuthCallback({port:0,provider:'drive',signal});
 try{
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:callback.redirectUri,response_type:'code',scope:DRIVE_FILE_SCOPE,access_type:'offline',prompt:'consent',trigger_onepick:'true',allow_multiple:'true',state:callback.state,code_challenge:callback.challenge,code_challenge_method:'S256',include_granted_scopes:'false'}))url.searchParams.set(key,value);
  await openBrowser(url.toString());const code=await callback.code.catch(()=>{throw new DriveAuthorizationError('callback');});
  const token=await tokenRequest(new URLSearchParams({client_id:clientId,...(client?{client_secret:client.clientSecret}:{}),redirect_uri:callback.redirectUri,code,code_verifier:callback.verifier,grant_type:'authorization_code'}),fetcher,signal);
  if(token.scope!==DRIVE_FILE_SCOPE||!token.refresh_token)throw new DriveAuthorizationError('grant');
  return driveCredentialSchema.parse({client,accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()+token.expires_in*1000,fileIds:callback.pickedFileIds(),scope:DRIVE_FILE_SCOPE});
 }finally{callback.cancel();}
}
export async function refreshDrive(value:DriveCredential,fetcher:typeof fetch=fetch):Promise<DriveCredential>{
 const credential=driveCredentialSchema.parse(value);if(credential.expiresAt>Date.now()+60000)return credential;
 const token=await tokenRequest(new URLSearchParams({client_id:credential.client?.clientId??DRIVE_DESKTOP_CLIENT_ID,...(credential.client?{client_secret:credential.client.clientSecret}:{}),refresh_token:credential.refreshToken,grant_type:'refresh_token'}),fetcher);
 return driveCredentialSchema.parse({...credential,accessToken:token.access_token,refreshToken:token.refresh_token??credential.refreshToken,expiresAt:Date.now()+token.expires_in*1000});
}
export async function revokeDrive(value:DriveCredential,fetcher:typeof fetch=fetch){
 const credential=driveCredentialSchema.parse(value);
 const response=await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token:credential.refreshToken}),redirect:'error',signal:AbortSignal.timeout(15000)});
 // Invalid tokens are already unusable. Unknown/network failures must retain
 // protected credentials so the user can retry a remotely confirmed revoke.
 if(response.status===400){const error=await boundedGoogleBody(new Response(response.body),32768).then(bytes=>JSON.parse(bytes.toString('utf8'))).catch(()=>null);if(error?.error==='invalid_token')return;throw new Error('Google revocation could not be confirmed');}
 if(!response.ok){await response.body?.cancel();throw new Error('Google revocation could not be confirmed');}
 await response.body?.cancel();
}
