import {z} from 'zod';
import {desktopAiSchema,desktopAiPreferencesSchema,desktopApiKeySchema,type DesktopAi,type DesktopAiPreferences} from '../../../src/desktop/ai-config.js';
import type {OperationResult} from './contracts.js';

export type AiKeyTarget='generation'|'embedding';
const searchStatusSchema=z.discriminatedUnion('semanticSearchAvailable',[
 z.object({semanticSearchAvailable:z.literal(true),semanticSearchReason:z.null()}),
 z.object({semanticSearchAvailable:z.literal(false),semanticSearchReason:z.enum(['not_configured','embedding_reindex_required'])})
]);
/** Project only engine-owned capability fields; never infer readiness from a saved key. */
export function desktopAiSearchStatus(runtime:OperationResult){
 const parsed=runtime.ok?searchStatusSchema.safeParse(runtime.data):null;
 return parsed?.success?parsed.data:{semanticSearchAvailable:null,semanticSearchReason:'runtime_unavailable' as const};
}
// Credential import precedes model selection. Only the selected destination is
// validated here; test/save apply the complete model and usage-limit contract.
export const aiKeyImportSchema=z.object({
 target:z.enum(['generation','embedding']),
 preferences:z.object({provider:z.enum(['openai','anthropic','google','openai-compatible']).optional(),baseUrl:z.string().max(2048).optional(),embeddingProvider:z.enum(['none','openai','openai-compatible']).optional(),embeddingBaseUrl:z.string().max(2048).optional()})
}).strict().transform(({target,preferences})=>({target,preferences:{
 ...(target==='generation'?{provider:preferences.provider,baseUrl:preferences.baseUrl,embeddingProvider:'none'}:{provider:'openai',embeddingProvider:preferences.embeddingProvider??((preferences.provider??'openai')==='openai'?'openai':'none'),embeddingBaseUrl:preferences.embeddingBaseUrl}),
 generationModel:'credential-import',embeddingModel:'text-embedding-3-small',embeddingDimensions:1536,maxRequestsPerDay:50,maxOutputTokens:2048
}})).pipe(z.object({target:z.enum(['generation','embedding']),preferences:desktopAiPreferencesSchema}).strict());
const draftLifetimeMs=15*60*1000;
const endpoint=(value:string|undefined)=>value?new URL(value).href.replace(/\/$/,''):'';
function keyScope(preferences:DesktopAiPreferences,target:AiKeyTarget){
 const generation=preferences.provider??'openai';
 const provider=target==='generation'?generation:preferences.embeddingProvider??(generation==='openai'?'openai':'none');
 const baseUrl=target==='generation'?preferences.baseUrl:preferences.embeddingBaseUrl;
 return JSON.stringify([provider,provider==='openai-compatible'?endpoint(baseUrl):'']);
}

/** Main-process-only draft. Neither keys nor a key-derived fingerprint cross IPC. */
export class AiSettingsSession {
 private drafts:Partial<Record<AiKeyTarget,{scope:string;key:string;expiresAt:number}>>={};
 private tested:{value:string;expiresAt:number}|undefined;
 constructor(private readonly now=()=>Date.now()){}
 importKey(target:AiKeyTarget,preferences:DesktopAiPreferences,key:string){
  this.tested=undefined;
  // Validate credentials without using provider-specific prefixes.
  desktopApiKeySchema.parse(key);
  this.drafts[target]={scope:keyScope(preferences,target),key,expiresAt:this.now()+draftLifetimeMs};
 }
 private key(target:AiKeyTarget,preferences:DesktopAiPreferences,saved:DesktopAi|null){
  const scope=keyScope(preferences,target),draft=this.drafts[target];
  if(draft&&draft.expiresAt>this.now()&&draft.scope===scope)return draft.key;
  if(saved&&keyScope(saved.preferences,target)===scope){
   if(target==='generation')return saved.apiKey;
   return saved.embeddingApiKey;
  }
  return undefined;
 }
 configuration(preferences:DesktopAiPreferences,saved:DesktopAi|null):DesktopAi{
  const apiKey=this.key('generation',preferences,saved);
  const embeddingProvider=preferences.embeddingProvider??((preferences.provider??'openai')==='openai'?'openai':'none');
  const reusesGenerationKey=(preferences.provider??'openai')==='openai'&&embeddingProvider==='openai';
  const embeddingApiKey=embeddingProvider==='none'||reusesGenerationKey?undefined:this.key('embedding',preferences,saved);
  return desktopAiSchema.parse({apiKey,preferences,...(embeddingApiKey?{embeddingApiKey}:{})});
 }
 async test(preferences:DesktopAiPreferences,saved:DesktopAi|null,run:(config:DesktopAi)=>Promise<void>){
  this.tested=undefined;
  const config=this.configuration(preferences,saved);
  await run(config);
  this.tested={value:JSON.stringify(config),expiresAt:this.now()+draftLifetimeMs};
 }
 confirmed(preferences:DesktopAiPreferences,saved:DesktopAi|null):DesktopAi{
  const config=this.configuration(preferences,saved);
  if(!this.tested||this.tested.expiresAt<=this.now()||this.tested.value!==JSON.stringify(config))throw new Error('Test the current provider settings before saving.');
  return config;
 }
 clear(target?:AiKeyTarget){if(target)delete this.drafts[target];else this.drafts={};this.tested=undefined;}
}
