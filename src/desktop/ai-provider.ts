import {z} from 'zod';
import {zodTextFormat} from 'openai/helpers/zod';
import {AppError} from '../app/errors.js';
import {createOpenAiClient} from '../lib/ai/openai-client.js';
import type {GenerationInput,GenerationProvider,TextStreamInput,EmbeddingProvider} from '../lib/ai/provider.js';
import type {AiLimiter} from '../lib/ai-ops/ai-limits.js';

export const desktopAiSchema=z.object({
 apiKey:z.string().min(20).max(512).regex(/^[\x21-\x7e]+$/),
 preferences:z.object({generationModel:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/),embeddingModel:z.literal('text-embedding-3-small'),embeddingDimensions:z.literal(1536),maxRequestsPerDay:z.number().int().min(1).max(1000),maxOutputTokens:z.number().int().min(128).max(8192)}).strict()
}).strict();
export type DesktopAi=z.infer<typeof desktopAiSchema>;
export function desktopAiEnvironment(ai:DesktopAi){
 return {OPENAI_API_KEY:ai.apiKey,OPENAI_EMBEDDING_MODEL:ai.preferences.embeddingModel,
  ...Object.fromEntries(['OPENAI_GENERATION_MODEL','SOCRATES_MODEL','SOCRATES_ESCALATION_MODEL','SOCRATES_ROUTER_MODEL','SOCRATES_MODEL_FAST','SOCRATES_MODEL_HIGH_QUALITY','SOCRATES_MODEL_FALLBACK','SOCRATES_CLASSIFIER_MODEL','SOCRATES_SUMMARY_MODEL','SOCRATES_RERANK_MODEL','VSCODE_SOCRATES_MODEL'].map(key=>[key,ai.preferences.generationModel]))};
}

/** Dedicated desktop provider: no mock fallback, hidden retries or model escalation.
 * All outbound model calls share a durable installation-wide request allowance.
 * This is a request ceiling, NOT a promised dollar spending limit. */
export class DesktopAiProvider implements GenerationProvider,EmbeddingProvider {
 private readonly client:ReturnType<typeof createOpenAiClient>;
 private readonly active=new Set<AbortController>();
 private revoked=false;
 constructor(private readonly config:DesktopAi,private readonly limiter:Pick<AiLimiter,'checkRequestLimit'>,client?:ReturnType<typeof createOpenAiClient>){
  desktopAiSchema.parse(config);
  this.client=client??createOpenAiClient({apiKey:config.apiKey,maxRetries:0,timeout:60000});
 }
 revoke(){this.revoked=true;for(const controller of this.active)controller.abort();}
 private async call<T>(input:string,signal:AbortSignal|undefined,operation:(signal:AbortSignal,progress:()=>void)=>Promise<T>,timeoutMs=60000):Promise<T>{
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new AppError(400,'AI timeout must be a positive finite number.','invalid_ai_timeout');
  if(this.revoked)throw new AppError(409,'AI access has been removed.','ai_revoked');
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(Buffer.byteLength(input,'utf8')>64000)throw new AppError(413,'The AI context exceeds the configured request bound.','ai_context_too_large');
  if(this.active.size>=2)throw new AppError(429,'Two AI requests are already active.','ai_busy');
  const controller=new AbortController();this.active.add(controller);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  let timer=setTimeout(abort,Math.min(timeoutMs,60000));
  const hardTimer=setTimeout(abort,60000);
  const progress=()=>{clearTimeout(timer);timer=setTimeout(abort,Math.min(timeoutMs,60000));};
  try{
   const limit=await this.limiter.checkRequestLimit({key:'desktop:external-ai',maxRequests:this.config.preferences.maxRequestsPerDay,windowMs:86400000});
   if(!limit.allowed)throw new AppError(429,'Your desktop AI request allowance is exhausted.','ai_request_budget_exceeded');
   if(controller.signal.aborted||this.revoked)throw new DOMException('Cancelled','AbortError');
   return await operation(controller.signal,progress);
  }catch(error){
   if(error instanceof AppError)throw error;
   if(controller.signal.aborted)throw new DOMException('AI request cancelled or timed out','AbortError');
   // Provider errors may contain credentials or prompts. Never forward/log them.
   throw new AppError(502,'The AI provider could not complete this request. Check configuration and retry.','ai_provider_failed');
  }finally{clearTimeout(timer);clearTimeout(hardTimer);signal?.removeEventListener('abort',abort);this.active.delete(controller);}
 }
 async generateObject<T extends z.ZodTypeAny>(input:GenerationInput<T>):Promise<z.infer<T>>{
  const format=zodTextFormat(input.schema,'orchestra_result');
  return this.call(input.prompt+(input.systemPrompt??'')+JSON.stringify(format),undefined,async signal=>{
   const response=await this.client.responses.create({model:this.config.preferences.generationModel,input:input.prompt,instructions:input.systemPrompt,max_output_tokens:Math.min(input.maxOutputTokens??this.config.preferences.maxOutputTokens,this.config.preferences.maxOutputTokens),text:{format},store:false},{signal});
   if(response.status!=='completed')throw new Error('Incomplete generation');
   return input.schema.parse(JSON.parse(response.output_text));
  },input.timeoutMs);
 }
 async streamText(input:TextStreamInput):Promise<string>{
  return this.call(input.prompt+(input.systemPrompt??''),input.signal,async(signal,progress)=>{
   const stream=await this.client.responses.create({model:this.config.preferences.generationModel,input:input.prompt,instructions:input.systemPrompt,max_output_tokens:Math.min(input.maxOutputTokens??this.config.preferences.maxOutputTokens,this.config.preferences.maxOutputTokens),stream:true,store:false},{signal});
   let text='',completed=false;
   for await(const event of stream){
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    if(event.type==='response.output_text.delta'){progress();text+=event.delta;if(Buffer.byteLength(text)>131072)throw new Error('Output too large');await input.onDelta(event.delta);}
    if(event.type==='response.completed')completed=true;
    if(event.type==='response.incomplete'||event.type==='response.failed'||event.type==='error')throw new Error('Incomplete generation');
   }
   if(!completed||!text.trim())throw new Error('Incomplete generation');
   return text;
  },input.timeoutMs);
 }
 async embedText(input:string):Promise<number[]>{
  return this.call(input,undefined,async signal=>{
   const response=await this.client.embeddings.create({model:this.config.preferences.embeddingModel,dimensions:this.config.preferences.embeddingDimensions,input},{signal});
   const vector=response.data[0]?.embedding;
   if(!vector||vector.length!==1536||vector.some(value=>!Number.isFinite(value)))throw new Error('Embedding identity mismatch');
   return vector;
  });
 }
}
