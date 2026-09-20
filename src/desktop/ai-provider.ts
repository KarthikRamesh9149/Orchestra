import {z} from 'zod';
import {zodTextFormat} from 'openai/helpers/zod';
import {AppError} from '../app/errors.js';
import type {createOpenAiClient} from '../lib/ai/openai-client.js';
import type {GenerationInput,GenerationProvider,TextStreamInput,EmbeddingProvider} from '../lib/ai/provider.js';
import type {AiLimiter} from '../lib/ai-ops/ai-limits.js';
import {desktopAiSchema,resolveDesktopEmbeddingIdentity,resolveDesktopEmbeddingEndpoint,type DesktopAi} from './ai-config.js';
import {postDesktopAi} from './ai-http.js';
import {consumeDesktopStream,generateDesktopText,object,openAiResponseText,streamDesktopText} from './ai-protocols.js';
import {deepResearchStructuredSchema} from '../modules/deep-research/schemas.js';
import {getDesktopProductWireSchema} from './ai-product-schemas.js';
import {compactDesktopWireSchema} from './ai-schema.js';
export * from './ai-config.js';

// Exercise the actual nested research contract plus bounded numeric output,
// not a trivial boolean that can conceal vendor schema incompatibilities.
export const desktopAiConnectionSchema=z.object({report:deepResearchStructuredSchema,confidence:z.number().min(0).max(1)}).strict();
export const desktopAiConnectionSample={report:{executiveSummary:'Synthetic source E1 checked.',findings:[],marketContext:[],expansionOpportunities:[],recommendedActions:[]},confidence:1};

/** Dedicated desktop provider: no mock fallback, hidden retries or model escalation.
 * All outbound model calls share a durable installation-wide request allowance.
 * This is a request ceiling, NOT a promised dollar spending limit. */
export class DesktopAiProvider implements GenerationProvider,EmbeddingProvider {
 private readonly client?:ReturnType<typeof createOpenAiClient>;
 private readonly config:DesktopAi;
 readonly unavailable:boolean;
 private readonly active=new Set<AbortController>();
 private revoked=false;
 constructor(config:DesktopAi,private readonly limiter:Pick<AiLimiter,'checkRequestLimit'>,client?:ReturnType<typeof createOpenAiClient>){
  // Parse a copy so a caller cannot mutate approved destinations or credentials
  // after construction. Real requests always use the bounded no-redirect HTTP
  // transport; the optional OpenAI client remains a backwards-compatible test seam.
  this.config=desktopAiSchema.parse(config);
  this.unavailable=resolveDesktopEmbeddingIdentity(this.config)===null;
  if(client&&(this.config.preferences.provider??'openai')!=='openai')throw new Error('An injected OpenAI client only supports native OpenAI generation.');
  this.client=client;
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
  let rejectAbort:()=>void=()=>{};
  const cancelled=new Promise<never>((_resolve,reject)=>{rejectAbort=()=>reject(new DOMException('AI request cancelled or timed out','AbortError'));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
  try{
   return await Promise.race([cancelled,(async()=>{
    const limit=await this.limiter.checkRequestLimit({key:'desktop:external-ai',maxRequests:this.config.preferences.maxRequestsPerDay,windowMs:86400000});
    if(!limit.allowed)throw new AppError(429,'Your desktop AI request allowance is exhausted.','ai_request_budget_exceeded');
    if(controller.signal.aborted||this.revoked)throw new DOMException('Cancelled','AbortError');
    const value=await operation(controller.signal,progress);
    if(controller.signal.aborted||this.revoked)throw new DOMException('Cancelled','AbortError');
    return value;
   })()]);
  }catch(error){
   if(error instanceof AppError)throw error;
   if(controller.signal.aborted)throw new DOMException('AI request cancelled or timed out','AbortError');
   // Provider errors may contain credentials or prompts. Never forward/log them.
   throw new AppError(502,'The AI provider could not complete this request. Check configuration and retry.','ai_provider_failed');
  }finally{clearTimeout(timer);clearTimeout(hardTimer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',rejectAbort);this.active.delete(controller);}
 }
 private maxTokens(requested:number|undefined):number{
  if(requested!==undefined&&(!Number.isInteger(requested)||requested<=0))throw new AppError(400,'AI output limit must be a positive integer.','invalid_ai_output_limit');
  return Math.min(requested??this.config.preferences.maxOutputTokens,this.config.preferences.maxOutputTokens);
 }
 async generateObject<T extends z.ZodTypeAny>(input:GenerationInput<T>):Promise<z.infer<T>>{
  const wireSchema=getDesktopProductWireSchema(input.schema);
  const generatedFormat=zodTextFormat(wireSchema,'orchestra_result');
  const format={...generatedFormat,schema:compactDesktopWireSchema(generatedFormat.schema)};
  const maxTokens=this.maxTokens(input.maxOutputTokens);
  return this.call(input.prompt+(input.systemPrompt??'')+JSON.stringify(format),undefined,async signal=>{
   const text=this.client?openAiResponseText(await this.client.responses.create({model:this.config.preferences.generationModel,input:input.prompt,instructions:input.systemPrompt,max_output_tokens:maxTokens,text:{format},store:false},{signal})):
    await generateDesktopText(this.config,{prompt:input.prompt,systemPrompt:input.systemPrompt,maxTokens,schema:format.schema},signal);
   const value=JSON.parse(text);
   // Only mapped product wire schemas own absence sentinels. Unrelated inputs
   // must not run preprocessing twice or lose their explicitly meaningful nulls.
   return input.schema.parse(wireSchema===input.schema?value:wireSchema.parse(value));
  },input.timeoutMs);
 }
 async streamText(input:TextStreamInput):Promise<string>{
  const maxTokens=this.maxTokens(input.maxOutputTokens);
  return this.call(input.prompt+(input.systemPrompt??''),input.signal,async(signal,progress)=>{
   if(!this.client)return streamDesktopText(this.config,{prompt:input.prompt,systemPrompt:input.systemPrompt,maxTokens},signal,input.onDelta,progress);
   const stream=await this.client.responses.create({model:this.config.preferences.generationModel,input:input.prompt,instructions:input.systemPrompt,max_output_tokens:maxTokens,stream:true,store:false},{signal});
   return consumeDesktopStream('openai',stream,signal,input.onDelta,progress);
  },input.timeoutMs);
 }
 async embedText(input:string):Promise<number[]>{
  const identity=resolveDesktopEmbeddingIdentity(this.config);
  if(!identity)throw new AppError(409,'Semantic embeddings are disabled. Lexical search remains available.','ai_embeddings_disabled');
  return this.call(input,undefined,async signal=>{
   const body={model:identity.model,dimensions:identity.dimensions,input};
   // A separately configured embedding endpoint never sees the generation key.
   const response=this.client&&identity.provider==='openai'&&!this.config.embeddingApiKey?await this.client.embeddings.create(body,{signal}):
    await (await postDesktopAi(resolveDesktopEmbeddingEndpoint(this.config)!,{Authorization:`Bearer ${this.config.embeddingApiKey??this.config.apiKey}`},body,signal)).json();
   const data=object(response).data;
   if(!Array.isArray(data)||data.length!==1)throw new Error('Invalid embedding response');
   const item=object(data[0]);
   const vector=item.embedding;
   if(item.index!==undefined&&item.index!==0)throw new Error('Embedding index mismatch');
   if(!Array.isArray(vector)||vector.length!==1536||vector.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error('Embedding identity mismatch');
   return vector as number[];
  });
 }
}

/** Explicit user-invoked connection test. Sends only synthetic text, never a
 * workspace document. This is at most one generation + one embedding request;
 * both may incur provider charges and do not certify a real product journey. */
export async function testDesktopAiConnection(config:DesktopAi):Promise<void>{
 const checked=desktopAiSchema.parse(config);
 let remaining=2;
 const provider=new DesktopAiProvider(checked,{checkRequestLimit:async()=>({allowed:remaining-->0,code:'allowed',remaining:Math.max(0,remaining)})});
 try{
  const result=await provider.generateObject({prompt:`Return exactly this synthetic connection-test JSON: ${JSON.stringify(desktopAiConnectionSample)}`,schema:desktopAiConnectionSchema,fallback:()=>{throw new Error('Connection tests cannot use a fallback.');},maxOutputTokens:checked.preferences.maxOutputTokens,timeoutMs:15000});
  if(JSON.stringify(result)!==JSON.stringify(desktopAiConnectionSample))throw new AppError(502,'The AI provider did not satisfy the synthetic connection contract.','ai_provider_failed');
  if(resolveDesktopEmbeddingIdentity(checked)){
   const timer=setTimeout(()=>provider.revoke(),15000);
   try{await provider.embedText('Orchestra synthetic connection test.');}finally{clearTimeout(timer);}
  }
 }finally{provider.revoke();}
}
