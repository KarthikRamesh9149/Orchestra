import {z} from 'zod';
import {startOAuthCallback} from './oauth-loopback.js';

// Public registration identifier. No shared client secret is shipped.
export const SLACK_DESKTOP_CLIENT_ID='11246081957072.12035271294499';
export const SLACK_DESKTOP_CALLBACK_PORT=43827;
export const slackCredentialSchema=z.object({
 teamId:z.string().regex(/^T[A-Z0-9]+$/),teamName:z.string().max(255),userId:z.string().regex(/^U[A-Z0-9]+$/),
 accessToken:z.string().min(10).max(4096),refreshToken:z.string().min(10).max(4096),
 expiresAt:z.number().int().positive(),scopes:z.array(z.enum(['channels:read','channels:history'])).length(2)
}).strict();
export type SlackCredential=z.infer<typeof slackCredentialSchema>;
const requiredScopes=['channels:read','channels:history'] as const;
const tokenSchema=z.object({access_token:z.string().min(10).max(4096),refresh_token:z.string().min(10).max(4096),expires_in:z.number().int().min(1).max(86400),scope:z.string().max(2048),token_type:z.literal('user')});

/** Fixed API destination, bounded response, no redirects or automatic retries. */
export async function slackRequest(method:'oauth.v2.access'|'auth.test'|'auth.revoke'|'conversations.list'|'conversations.history'|'conversations.replies',params:URLSearchParams,token?:string,fetchImpl:typeof fetch=fetch,signal?:AbortSignal):Promise<unknown>{
 const response=await fetchImpl(`https://slack.com/api/${method}`,{method:'POST',body:params,headers:{'content-type':'application/x-www-form-urlencoded',...(token?{authorization:`Bearer ${token}`}:{})},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 if(!response.ok){await response.body?.cancel();throw new Error(response.status===429?'Slack rate limit reached; retry later.':'Slack request failed.');}
 if(!response.body)throw new Error('Empty Slack response');
 const reader=response.body.getReader();const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error('Slack response exceeds limit');parts.push(value);}}
 finally{await reader.cancel();}
 let payload:unknown;try{payload=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new Error('Invalid Slack response');}
 // Revocation is retriable after a partially completed disconnect. These errors
 // mean the supplied token is already unusable; never tolerate them on reads.
 if(method==='auth.revoke'&&z.object({ok:z.literal(false),error:z.enum(['token_revoked','token_expired','invalid_auth'])}).safeParse(payload).success)return {ok:true,revoked:true};
 if(!z.object({ok:z.literal(true)}).safeParse(payload).success)throw new Error('Slack rejected the request; check access or reconnect.');
 return payload;
}
function parseToken(value:unknown){
 const token=tokenSchema.parse(value);const scopes=token.scope.split(',').filter(Boolean);
 // Slack includes the implicit self-identity scope on rotated user tokens even
 // when the initial authed_user response lists only the requested read scopes.
 if(new Set(scopes).size!==scopes.length||scopes.some(scope=>!['identify',...requiredScopes].includes(scope))||requiredScopes.some(scope=>!scopes.includes(scope)))throw new Error('Unexpected Slack permissions; reconnect with read-only scopes.');
 return {accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()+token.expires_in*1000,scopes:[...requiredScopes]};
}
export async function connectSlack(openBrowser:(url:string)=>Promise<void>,signal?:AbortSignal,fetchImpl:typeof fetch=fetch):Promise<SlackCredential>{
 const callback=await startOAuthCallback({port:SLACK_DESKTOP_CALLBACK_PORT,signal});
 try{
  const url=new URL('https://slack.com/oauth/v2/authorize');
  for(const [key,value] of Object.entries({client_id:SLACK_DESKTOP_CLIENT_ID,scope:'',user_scope:requiredScopes.join(','),redirect_uri:callback.redirectUri,state:callback.state,code_challenge:callback.challenge,code_challenge_method:'S256'}))url.searchParams.set(key,value);
  await openBrowser(url.toString());const code=await callback.code;
  const payload=z.object({team:z.object({id:z.string(),name:z.string()}),authed_user:tokenSchema.extend({id:z.string()})}).parse(await slackRequest('oauth.v2.access',new URLSearchParams({client_id:SLACK_DESKTOP_CLIENT_ID,redirect_uri:callback.redirectUri,code,code_verifier:callback.verifier}),undefined,fetchImpl,signal));
  const credential=slackCredentialSchema.parse({...parseToken(payload.authed_user),teamId:payload.team.id,teamName:payload.team.name,userId:payload.authed_user.id});
  const identity=z.object({team_id:z.string(),user_id:z.string()}).parse(await slackRequest('auth.test',new URLSearchParams(),credential.accessToken,fetchImpl,signal));
  if(identity.team_id!==credential.teamId||identity.user_id!==credential.userId)throw new Error('Slack identity mismatch');
  return credential;
 }finally{callback.cancel();}
}
/** Caller serializes refresh AND durable save; retrying a spent refresh token is unsafe. */
export async function refreshSlack(value:SlackCredential,fetchImpl:typeof fetch=fetch,signal?:AbortSignal):Promise<SlackCredential>{
 const credential=slackCredentialSchema.parse(value);
 if(credential.expiresAt>Date.now()+60000)return credential;
 const payload=await slackRequest('oauth.v2.access',new URLSearchParams({grant_type:'refresh_token',client_id:SLACK_DESKTOP_CLIENT_ID,refresh_token:credential.refreshToken}),undefined,fetchImpl,signal);
 return slackCredentialSchema.parse({...credential,...parseToken(payload)});
}
/** Revoke minting authority first, then access. Never rotate to disconnect. */
export async function revokeSlack(value:SlackCredential,fetchImpl:typeof fetch=fetch):Promise<void>{
 const credential=slackCredentialSchema.parse(value);
 for(const token of [credential.refreshToken,credential.accessToken]){
  z.object({ok:z.literal(true),revoked:z.literal(true)}).parse(await slackRequest('auth.revoke',new URLSearchParams({token}),undefined,fetchImpl));
 }
}
