import {beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {DesktopAiProvider,testDesktopAiConnection,desktopAiConnectionSample} from '../src/desktop/ai-provider.js';
import {desktopAiEnvironment,desktopAiPreferencesSchema,desktopAiSchema,resolveDesktopEmbeddingIdentity,type DesktopAi} from '../src/desktop/ai-config.js';
import {postDesktopAi} from '../src/desktop/ai-http.js';

vi.mock('../src/desktop/ai-http.js',async importOriginal=>({...await importOriginal<typeof import('../src/desktop/ai-http.js')>(),postDesktopAi:vi.fn()}));
const post=vi.mocked(postDesktopAi);
const secret='synthetic-generation-key-only';
const embeddingKey='synthetic-embedding-key-only';
type Provider=NonNullable<DesktopAi['preferences']['provider']>;
const providers:Provider[]=['openai','openai-compatible','anthropic','google'];
function config(provider:Provider='openai'):DesktopAi{
 return {apiKey:secret,preferences:{provider,...(provider==='openai-compatible'?{baseUrl:'https://api.example.com/v1/'}:{}),generationModel:'test-model',embeddingProvider:'none',embeddingModel:'text-embedding-3-small',embeddingDimensions:1536,maxRequestsPerDay:10,maxOutputTokens:256}};
}
function setup(provider:Provider='openai',override?:DesktopAi){
 const checkRequestLimit=vi.fn().mockResolvedValue({allowed:true,code:'allowed'});
 return {provider:new DesktopAiProvider(override??config(provider),{checkRequestLimit}),checkRequestLimit};
}
function reply(value:unknown,events:unknown[]=[]){
 post.mockResolvedValue({json:async()=>value,events:()=> (async function*(){for(const event of events)yield event;})()});
}
const outputs:Record<Provider,unknown>={
 openai:{status:'completed',output:[{type:'message',status:'completed',content:[{type:'output_text',text:'{"ok":true}'}]}]},
 'openai-compatible':{choices:[{index:0,finish_reason:'stop',message:{content:'{"ok":true}',refusal:null}}]},
 anthropic:{type:'message',stop_reason:'tool_use',content:[{type:'tool_use',id:'synthetic-result',name:'orchestra_result',input:{ok:true}}]},
 google:{candidates:[{index:0,finishReason:'STOP',content:{parts:[{text:'{"ok":true}'}]}}]}
};
const completed=(text:string)=>({type:'response.completed',response:{status:'completed',output:[{type:'message',status:'completed',content:[{type:'output_text',text}]}]}});
const streams:Record<Provider,unknown[]>={
 openai:[{type:'response.output_text.delta',delta:'Evidence '},{type:'response.output_text.delta',delta:'answer'},completed('Evidence answer')],
 'openai-compatible':[{choices:[{index:0,delta:{content:'Evidence '},finish_reason:null}]},{choices:[{index:0,delta:{content:'answer'},finish_reason:'stop'}]}],
 anthropic:[{type:'message_start',message:{type:'message'}},{type:'content_block_start',content_block:{type:'text',text:''}},{type:'content_block_delta',delta:{type:'text_delta',text:'Evidence '}},{type:'content_block_delta',delta:{type:'text_delta',text:'answer'}},{type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'}],
 google:[{candidates:[{index:0,content:{parts:[{text:'Evidence '}]}}]},{candidates:[{index:0,content:{parts:[{text:'answer'}]},finishReason:'STOP'}]}]
};
beforeEach(()=>{post.mockReset();});

describe('desktop provider configuration contract',()=>{
 it('preserves legacy OpenAI settings and embedding identity',()=>{
  const legacy=config();delete legacy.preferences.provider;delete legacy.preferences.embeddingProvider;
  expect(desktopAiSchema.parse(legacy)).toEqual(legacy);
  expect(resolveDesktopEmbeddingIdentity(legacy)).toEqual({provider:'openai',model:'text-embedding-3-small',dimensions:1536});
 });
 it('defaults other generation vendors to lexical-only without reusing their keys',()=>{
  for(const provider of providers.filter(value=>value!=='openai')){
   const selected=config(provider);delete selected.preferences.embeddingProvider;
   expect(resolveDesktopEmbeddingIdentity(desktopAiSchema.parse(selected))).toBeNull();
   expect(desktopAiEnvironment(selected)).toMatchObject({DESKTOP_AI_PROVIDER:provider,OPENAI_API_KEY:'',OPENAI_EMBEDDING_MODEL:'mock'});
  }
 });
 it('requires a distinct embedding credential for other native or compatible generation',()=>{
  for(const embeddingProvider of ['openai','openai-compatible'] as const){
   const selected=config('anthropic');selected.preferences.embeddingProvider=embeddingProvider;
   if(embeddingProvider==='openai-compatible')selected.preferences.embeddingBaseUrl='https://embeddings.example.com/v1';
   expect(desktopAiSchema.safeParse(selected).success).toBe(false);
   selected.embeddingApiKey=embeddingKey;
   expect(desktopAiSchema.safeParse(selected).success).toBe(true);
  }
 });
 it('normalises endpoint identity while retaining the supplied preference shape',()=>{
  const selected=config('anthropic');Object.assign(selected.preferences,{embeddingProvider:'openai-compatible',embeddingBaseUrl:'https://EMBEDDINGS.example.com:443/v1/',embeddingModel:'vendor/embedding:model-v2'});selected.embeddingApiKey=embeddingKey;
  expect(desktopAiSchema.parse(selected)).toEqual(selected);
  expect(resolveDesktopEmbeddingIdentity(selected)).toEqual({provider:'openai-compatible',endpoint:'https://embeddings.example.com/v1',model:'vendor/embedding:model-v2',dimensions:1536});
  expect(desktopAiEnvironment(selected).OPENAI_EMBEDDING_MODEL).toBe('vendor/embedding:model-v2');
 });
 it('rejects missing or inappropriate endpoint fields, arbitrary headers and vector dimensions',()=>{
  const native=config(),compatible=config('openai-compatible');
  for(const preferences of [{...native.preferences,baseUrl:'https://api.example.com/v1'},{...compatible.preferences,baseUrl:undefined},{...native.preferences,embeddingBaseUrl:'https://api.example.com/v1'},{...native.preferences,headers:{Authorization:'secret'}},{...native.preferences,embeddingDimensions:3072},{...native.preferences,embeddingProvider:'openai',embeddingModel:'unsupported'}])expect(desktopAiPreferencesSchema.safeParse(preferences).success).toBe(false);
 });
 it('allows namespaced model IDs without allowing control characters or URL syntax',()=>{
  expect(desktopAiPreferencesSchema.safeParse({...config('openai-compatible').preferences,generationModel:'vendor/model:version+variant'}).success).toBe(true);
  for(const generationModel of ['', 'model\nkey', 'model?token=secret', 'x'.repeat(201)])expect(desktopAiPreferencesSchema.safeParse({...config().preferences,generationModel}).success).toBe(false);
 });
 it('rejects unsafe key characters and stale embedding credentials in lexical mode',()=>{
  for(const apiKey of ['tiny','with spaces','key\r\nHost:evil', 'x'.repeat(4097)])expect(desktopAiSchema.safeParse({...config(),apiKey}).success).toBe(false);
  expect(desktopAiSchema.safeParse({...config(),embeddingApiKey:embeddingKey}).success).toBe(false);
 });
});

describe.each(providers)('%s generation protocol',provider=>{
 it('validates structured output, honours the selected model and never invokes fallback',async()=>{
  reply(outputs[provider]);const state=setup(provider),fallback=vi.fn();
  await expect(state.provider.generateObject({prompt:'Synthetic question',systemPrompt:'Evidence only',schema:z.object({ok:z.literal(true)}),fallback,maxOutputTokens:5000,model:'never-use-this'})).resolves.toEqual({ok:true});
  const [url,headers,body]=post.mock.calls[0];
  expect(JSON.stringify(body)).toContain('Synthetic question');expect(JSON.stringify(body)).not.toContain('never-use-this');
  expect(fallback).not.toHaveBeenCalled();expect(state.checkRequestLimit).toHaveBeenCalledTimes(1);
  if(provider==='openai'){expect(url).toBe('https://api.openai.com/v1/responses');expect(headers).toEqual({Authorization:`Bearer ${secret}`});expect(body).toMatchObject({model:'test-model',store:false,max_output_tokens:256,text:{format:{type:'json_schema',strict:true}}});}
  if(provider==='openai-compatible'){expect(url).toBe('https://api.example.com/v1/chat/completions');expect(headers).toEqual({Authorization:`Bearer ${secret}`});expect(body).toMatchObject({model:'test-model',max_tokens:256,response_format:{type:'json_schema',json_schema:{strict:true}}});}
  if(provider==='anthropic'){expect(url).toBe('https://api.anthropic.com/v1/messages');expect(headers).toEqual({'x-api-key':secret,'anthropic-version':'2023-06-01'});expect(body).toMatchObject({model:'test-model',max_tokens:256,system:'Evidence only',tools:[{name:'orchestra_result',input_schema:{type:'object'}}],tool_choice:{type:'tool',name:'orchestra_result',disable_parallel_tool_use:true}});expect(body).not.toHaveProperty('output_config');expect((body as {tools:Record<string,unknown>[]}).tools[0]).not.toHaveProperty('strict');}
  if(provider==='google'){expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');expect(headers).toEqual({'x-goog-api-key':secret});expect(body).toMatchObject({generationConfig:{maxOutputTokens:256,responseMimeType:'application/json',candidateCount:1}});expect(url).not.toContain(secret);}
 });
 it('streams only text with an explicit successful terminal marker',async()=>{
  reply(null,streams[provider]);const {provider:client}=setup(provider),onDelta=vi.fn();
  await expect(client.streamText({prompt:'Question',fallback:()=>'',onDelta})).resolves.toBe('Evidence answer');
  expect(onDelta.mock.calls.map(call=>call[0]).join('')).toBe('Evidence answer');
  if(provider==='google')expect(post.mock.calls[0][0].endsWith(':streamGenerateContent?alt=sse')).toBe(true);
  if(provider==='anthropic')expect(post.mock.calls[0][2]).not.toHaveProperty('tools');
 });
 it('rejects incomplete streams and does not claim a fallback answer',async()=>{
  reply(null,streams[provider].slice(0,-1));const {provider:client}=setup(provider),fallback=vi.fn();
  await expect(client.streamText({prompt:'Question',fallback,onDelta:()=>{}})).rejects.toMatchObject({code:'ai_provider_failed'});expect(fallback).not.toHaveBeenCalled();
 });
 it('independently validates JSON against the requested schema',async()=>{
  reply(outputs[provider]);const {provider:client}=setup(provider);
  await expect(client.generateObject({prompt:'Question',schema:z.object({missing:z.string()}),fallback:()=>({missing:'fake'})})).rejects.toMatchObject({code:'ai_provider_failed'});
 });
 it('never transmits after denial, revocation or early cancellation',async()=>{
  reply(outputs[provider]);const {provider:client,checkRequestLimit}=setup(provider);checkRequestLimit.mockResolvedValue({allowed:false});
  await expect(client.streamText({prompt:'Question',fallback:()=>'',onDelta:()=>{}})).rejects.toMatchObject({code:'ai_request_budget_exceeded'});
  await expect(client.streamText({prompt:'Question',fallback:()=>'',onDelta:()=>{},signal:AbortSignal.abort()})).rejects.toMatchObject({name:'AbortError'});
  client.revoke();await expect(client.generateObject({prompt:'Question',schema:z.object({ok:z.boolean()}),fallback:()=>({ok:false})})).rejects.toMatchObject({code:'ai_revoked'});expect(post).not.toHaveBeenCalled();
 });
 it('redacts errors, including provider-supplied secrets and input',async()=>{
  post.mockRejectedValue(new Error(`${secret} Synthetic private question`));const {provider:client}=setup(provider);
  await expect(client.streamText({prompt:'Synthetic private question',fallback:()=>'',onDelta:()=>{}})).rejects.toMatchObject({code:'ai_provider_failed'});
  await expect(client.streamText({prompt:'Synthetic private question',fallback:()=>'',onDelta:()=>{}})).rejects.not.toThrow(secret);
 });
});

describe('provider refusal, truncation and malformed-response handling',()=>{
 const failures:[Provider,unknown][]=[
  ['openai',{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}],
  ['openai',{status:'incomplete',output_text:'{"ok":true}'}],
  ['openai-compatible',{choices:[{finish_reason:'length',message:{content:'{"ok":true}'}}]}],
  ['openai-compatible',{choices:[{finish_reason:'stop',message:{content:'{"ok":true}',refusal:'No'}}]}],
  ['openai-compatible',{choices:[{finish_reason:'tool_calls',message:{tool_calls:[]}}]}],
  ['anthropic',{type:'message',stop_reason:'refusal',content:[{type:'text',text:'{"ok":true}'}]}],
  ['anthropic',{type:'message',stop_reason:'max_tokens',content:[{type:'text',text:'{"ok":true}'}]}],
  ['google',{promptFeedback:{blockReason:'SAFETY'}}],
  ['google',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"ok":true}'}]}}]}],
  ['google',{candidates:[{finishReason:'STOP',safetyRatings:[{blocked:true}],content:{parts:[{text:'{"ok":true}'}]}}]}]
 ];
 it.each(failures)('rejects failed structured output for %s',async(provider,value)=>{
  reply(value);await expect(setup(provider).provider.generateObject({prompt:'Question',schema:z.object({ok:z.boolean()}),fallback:()=>({ok:false})})).rejects.toMatchObject({code:'ai_provider_failed'});
 });
 it.each([
  ['openai',[{type:'response.refusal.delta',delta:'Refused'}]],
  ['openai-compatible',[{choices:[{delta:{content:'partial'},finish_reason:'length'}]}]],
  ['openai-compatible',[{choices:[{delta:{refusal:'No'},finish_reason:'stop'}]}]],
  ['anthropic',[{type:'message_delta',delta:{stop_reason:'max_tokens'}}]],
  ['anthropic',[{type:'content_block_start',content_block:{type:'tool_use'}}]],
  ['google',[{candidates:[{finishReason:'SAFETY',content:{parts:[{text:'partial'}]}}]}]]
 ] as [Provider,unknown[]][])('rejects failed streams for %s',async(provider,events)=>{
  reply(null,events);await expect(setup(provider).provider.streamText({prompt:'Question',fallback:()=>'',onDelta:()=>{}})).rejects.toMatchObject({code:'ai_provider_failed'});
 });
 it('ignores Gemini internal thought while preserving only the final answer',async()=>{
  reply(null,[{candidates:[{content:{parts:[{thought:true,text:'Internal thought'},{text:'Evidence answer'}]},finishReason:'STOP'}]}]);const onDelta=vi.fn();
  await expect(setup('google').provider.streamText({prompt:'Question',fallback:()=>'',onDelta})).resolves.toBe('Evidence answer');expect(onDelta).toHaveBeenCalledExactlyOnceWith('Evidence answer');
 });
});

describe('separate embeddings and request hard bounds',()=>{
 it('keeps lexical-only embedding requests offline and outside the request allowance',async()=>{
  const {provider,checkRequestLimit}=setup('anthropic');expect(provider.unavailable).toBe(true);
  await expect(provider.embedText('x')).rejects.toMatchObject({code:'ai_embeddings_disabled'});expect(checkRequestLimit).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled();
 });
 it('uses only the embedding key, model and endpoint and enforces 1536 finite numbers',async()=>{
  const selected=config('anthropic');selected.embeddingApiKey=embeddingKey;Object.assign(selected.preferences,{embeddingProvider:'openai-compatible',embeddingBaseUrl:'https://vectors.example.com/v1/',embeddingModel:'vendor/vector-1536'});
  const {provider}=setup('anthropic',selected);reply({data:[{index:0,embedding:Array(1536).fill(0.25)}]});
  expect(await provider.embedText('Synthetic embedding input')).toHaveLength(1536);
  expect(post.mock.calls[0].slice(0,3)).toEqual(['https://vectors.example.com/v1/embeddings',{Authorization:`Bearer ${embeddingKey}`},{model:'vendor/vector-1536',dimensions:1536,input:'Synthetic embedding input'}]);
  for(const embedding of [[0.1],Array(1536).fill(NaN),Array(1536).fill('0.1')]){reply({data:[{embedding}]});await expect(provider.embedText('x')).rejects.toMatchObject({code:'ai_provider_failed'});}
 });
 it('enforces a timeout even if an injected transport ignores the abort signal',async()=>{
  post.mockImplementation(()=>new Promise(()=>{}));const {provider}=setup();
  await expect(provider.streamText({prompt:'Question',fallback:()=>'',onDelta:()=>{},timeoutMs:5})).rejects.toMatchObject({name:'AbortError'});
 });
 it('stops active streaming after cancellation without forwarding further deltas',async()=>{
  reply(null,streams['openai-compatible']);const {provider}=setup('openai-compatible'),abort=new AbortController(),onDelta=vi.fn(()=>abort.abort());
  await expect(provider.streamText({prompt:'Question',fallback:()=>'',onDelta,signal:abort.signal})).rejects.toMatchObject({name:'AbortError'});expect(onDelta).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid token ceilings and oversized contexts before budget consumption',async()=>{
  const {provider,checkRequestLimit}=setup();for(const maxOutputTokens of [NaN,Infinity,0,-1,1.5])await expect(provider.streamText({prompt:'x',fallback:()=>'',onDelta:()=>{},maxOutputTokens})).rejects.toMatchObject({code:'invalid_ai_output_limit'});
  await expect(provider.streamText({prompt:'x'.repeat(64001),fallback:()=>'',onDelta:()=>{}})).rejects.toMatchObject({code:'ai_context_too_large'});expect(checkRequestLimit).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled();
 });
 it('does not allow caller mutation to change the approved endpoint or key',async()=>{
  const selected=config('openai-compatible');const {provider}=setup('openai-compatible',selected);selected.apiKey='changed-secret';selected.preferences.baseUrl='https://changed.example.com';reply(outputs['openai-compatible']);
  await provider.generateObject({prompt:'Question',schema:z.object({ok:z.boolean()}),fallback:()=>({ok:false})});expect(post.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');expect(post.mock.calls[0][1]).toEqual({Authorization:`Bearer ${secret}`});
 });
 it('uses only synthetic text and at most two requests for the explicit connection test',async()=>{
  const selected=config();selected.preferences.embeddingProvider='openai';post.mockResolvedValueOnce({json:async()=>({status:'completed',output_text:JSON.stringify(desktopAiConnectionSample)}),events:async function*(){}}).mockResolvedValueOnce({json:async()=>({data:[{embedding:Array(1536).fill(.1)}]}),events:async function*(){}});
  await expect(testDesktopAiConnection(selected)).resolves.toBeUndefined();expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[0][2]).toMatchObject({input:`Return exactly this synthetic connection-test JSON: ${JSON.stringify(desktopAiConnectionSample)}`,max_output_tokens:selected.preferences.maxOutputTokens});expect(post.mock.calls[1][2]).toMatchObject({input:'Orchestra synthetic connection test.'});
 });
 it('does not test embeddings after a failed generation test',async()=>{
  const selected=config();selected.preferences.embeddingProvider='openai';reply({status:'failed'});await expect(testDesktopAiConnection(selected)).rejects.toMatchObject({code:'ai_provider_failed'});expect(post).toHaveBeenCalledTimes(1);
 });
 it('caps concurrent calls and aborts both active requests on revocation',async()=>{
  post.mockImplementation(()=>new Promise(()=>{}));const {provider,checkRequestLimit}=setup();
  const first=provider.streamText({prompt:'First',fallback:()=>'',onDelta:()=>{}});
  const second=provider.streamText({prompt:'Second',fallback:()=>'',onDelta:()=>{}});
  const outcomes=Promise.allSettled([first,second]);
  await expect(provider.streamText({prompt:'Third',fallback:()=>'',onDelta:()=>{}})).rejects.toMatchObject({code:'ai_busy'});
  expect(checkRequestLimit).toHaveBeenCalledTimes(2);provider.revoke();
  for(const result of await outcomes)expect(result).toMatchObject({status:'rejected',reason:{name:'AbortError'}});
 });
 it('does not leave a request pending when the delta consumer stalls',async()=>{
  reply(null,streams.openai);const {provider}=setup();
  await expect(provider.streamText({prompt:'Question',fallback:()=>'',onDelta:()=>new Promise(()=>{}),timeoutMs:5})).rejects.toMatchObject({name:'AbortError'});
 });
 it('bounds text output before passing it to the consumer',async()=>{
  reply(null,[{type:'response.output_text.delta',delta:'x'.repeat(131073)},completed('x'.repeat(131073))]);const {provider}=setup(),onDelta=vi.fn();
  await expect(provider.streamText({prompt:'Question',fallback:()=>'',onDelta})).rejects.toMatchObject({code:'ai_provider_failed'});expect(onDelta).not.toHaveBeenCalled();
 });
 it('fails malformed JSON without repairing or inventing a structured result',async()=>{
  reply({status:'completed',output_text:'```json\n{"ok":true}\n```'});const {provider}=setup(),fallback=vi.fn();
  await expect(provider.generateObject({prompt:'Question',schema:z.object({ok:z.boolean()}),fallback})).rejects.toMatchObject({code:'ai_provider_failed'});expect(fallback).not.toHaveBeenCalled();
 });
 it('rejects content delivered after a successful terminal marker',async()=>{
  reply(null,[...streams.openai,{type:'response.output_text.delta',delta:'late'}]);const {provider}=setup();
  await expect(provider.streamText({prompt:'Question',fallback:()=>'',onDelta:()=>{}})).rejects.toMatchObject({code:'ai_provider_failed'});
 });
 it.each([
  {type:'response.completed'},
  completed('The full supported answer.'),
  {type:'response.completed',response:{status:'incomplete',output_text:'The full'}},
  {type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}}
 ])('rejects missing, inconsistent, incomplete or refused OpenAI terminal output',async terminal=>{
  reply(null,[{type:'response.output_text.delta',delta:'The full'},terminal]);const {provider}=setup(),onDelta=vi.fn();
  await expect(provider.streamText({prompt:'Question',fallback:()=>'',onDelta})).rejects.toMatchObject({code:'ai_provider_failed'});
  expect(onDelta).toHaveBeenCalledExactlyOnceWith('The full');
 });
});
