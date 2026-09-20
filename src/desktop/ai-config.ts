import {z} from 'zod';
import {validateDesktopAiBaseUrl} from './ai-http.js';

export const desktopApiKeySchema=z.string().min(8).max(4096).regex(/^[\x21-\x7e]+$/);
export const desktopAiModelSchema=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/+\-]{0,199}$/);
const baseUrlSchema=z.string().max(2048).superRefine((value,context)=>{
 try{validateDesktopAiBaseUrl(value);}catch{context.addIssue({code:z.ZodIssueCode.custom,message:'Use a public HTTPS API base URL without credentials, query, fragment or a custom port.'});}
});

/** Optional fields preserve vault v1 settings. Omitted provider means native
 * OpenAI; omitted embedding provider means OpenAI only for that legacy setup. */
export const desktopAiPreferencesSchema=z.object({
 provider:z.enum(['openai','openai-compatible','anthropic','google']).optional(),
 baseUrl:baseUrlSchema.optional(),
 generationModel:desktopAiModelSchema,
 embeddingProvider:z.enum(['openai','openai-compatible','none']).optional(),
 embeddingBaseUrl:baseUrlSchema.optional(),
 embeddingModel:desktopAiModelSchema,
 embeddingDimensions:z.literal(1536),
 maxRequestsPerDay:z.number().int().min(1).max(1000),
 maxOutputTokens:z.number().int().min(128).max(8192)
}).strict().superRefine((preferences,context)=>{
 const provider=preferences.provider??'openai';
 const embeddingProvider=preferences.embeddingProvider??(provider==='openai'?'openai':'none');
 const issue=(path:string,message:string)=>context.addIssue({code:z.ZodIssueCode.custom,path:[path],message});
 if((provider==='openai-compatible')!==Boolean(preferences.baseUrl))issue('baseUrl','Only compatible generation requires an API base URL.');
 if((embeddingProvider==='openai-compatible')!==Boolean(preferences.embeddingBaseUrl))issue('embeddingBaseUrl','Only compatible embeddings require an API base URL.');
 if(embeddingProvider==='openai'&&preferences.embeddingModel!=='text-embedding-3-small')issue('embeddingModel','Native OpenAI embeddings use text-embedding-3-small at 1536 dimensions.');
});
export type DesktopAiPreferences=z.infer<typeof desktopAiPreferencesSchema>;

export const desktopAiSchema=z.object({apiKey:desktopApiKeySchema,embeddingApiKey:desktopApiKeySchema.optional(),preferences:desktopAiPreferencesSchema}).strict().superRefine((config,context)=>{
 const generation=config.preferences.provider??'openai';
 const embeddings=config.preferences.embeddingProvider??(generation==='openai'?'openai':'none');
 if((embeddings==='openai-compatible'||(embeddings==='openai'&&generation!=='openai'))&&!config.embeddingApiKey){
  context.addIssue({code:z.ZodIssueCode.custom,path:['embeddingApiKey'],message:'Add a separate API key for the selected embedding provider.'});
 }
 if(embeddings==='none'&&config.embeddingApiKey){
  context.addIssue({code:z.ZodIssueCode.custom,path:['embeddingApiKey'],message:'Remove the embedding key when using lexical-only search.'});
 }
});
export type DesktopAi=z.infer<typeof desktopAiSchema>;
export interface DesktopEmbeddingIdentity {provider:'openai'|'openai-compatible';model:string;dimensions:1536;endpoint?:string}

export function resolveDesktopEmbeddingIdentity(config:DesktopAi):DesktopEmbeddingIdentity|null{
 const preferences=config.preferences;
 const provider=preferences.embeddingProvider??((preferences.provider??'openai')==='openai'?'openai':'none');
 if(provider==='none')return null;
 return {provider,model:preferences.embeddingModel,dimensions:1536,...(provider==='openai-compatible'?{endpoint:validateDesktopAiBaseUrl(preferences.embeddingBaseUrl!)}:{})};
}

/** The base URL is a service API prefix, e.g. https://api.example.com/v1. */
export function resolveDesktopGenerationEndpoint(preferences:DesktopAiPreferences):string{
 switch(preferences.provider??'openai'){
  case 'openai':return 'https://api.openai.com/v1/responses';
  case 'anthropic':return 'https://api.anthropic.com/v1/messages';
  case 'google':return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(preferences.generationModel.replace(/^models\//,''))}:generateContent`;
  case 'openai-compatible':return `${validateDesktopAiBaseUrl(preferences.baseUrl!)}/chat/completions`;
 }
}

export function resolveDesktopEmbeddingEndpoint(config:DesktopAi):string|null{
 const identity=resolveDesktopEmbeddingIdentity(config);
 return identity?`${identity.endpoint??'https://api.openai.com/v1'}/embeddings`:null;
}

export function desktopAiEnvironment(ai:DesktopAi){
 return {
  DESKTOP_AI_PROVIDER:ai.preferences.provider??'openai',
  // These legacy environment fields are metadata only. Other vendors' secrets
  // must never become OpenAI keys; the injected desktop provider owns transport.
  OPENAI_API_KEY:(ai.preferences.provider??'openai')==='openai'?ai.apiKey:'',
  OPENAI_EMBEDDING_MODEL:resolveDesktopEmbeddingIdentity(ai)?.model??'mock',
  ...Object.fromEntries(['OPENAI_GENERATION_MODEL','SOCRATES_MODEL','SOCRATES_ESCALATION_MODEL','SOCRATES_ROUTER_MODEL','SOCRATES_MODEL_FAST','SOCRATES_MODEL_HIGH_QUALITY','SOCRATES_MODEL_FALLBACK','SOCRATES_CLASSIFIER_MODEL','SOCRATES_SUMMARY_MODEL','SOCRATES_RERANK_MODEL','VSCODE_SOCRATES_MODEL'].map(key=>[key,ai.preferences.generationModel]))
 };
}
