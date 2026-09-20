import {postDesktopAi} from './ai-http.js';
import {resolveDesktopGenerationEndpoint,type DesktopAi} from './ai-config.js';

type JsonObject=Record<string,unknown>;
export function object(value:unknown):JsonObject{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid provider object');
 return value as JsonObject;
}
function list(value:unknown):unknown[]{if(!Array.isArray(value))throw new Error('Invalid provider array');return value;}
function string(value:unknown):string{if(typeof value!=='string')throw new Error('Invalid provider text');return value;}
export function boundedText(value:unknown):string{
 const text=string(value);
 if(!text.trim()||Buffer.byteLength(text,'utf8')>131072)throw new Error('Invalid provider output length');
 return text;
}

export function openAiResponseText(value:unknown):string{
 const response=object(value);
 if(response.status!=='completed'||response.error||response.incomplete_details)throw new Error('Incomplete generation');
 let text='';
 if(response.output!==undefined){
  for(const item of list(response.output)){
   const output=object(item);
   if(output.type==='reasoning')continue;
   if(output.type!=='message'||(output.status!==undefined&&output.status!=='completed'))throw new Error('Unsupported generation output');
   for(const item of list(output.content)){
    const part=object(item);
    if(part.type!=='output_text')throw new Error('Refused or unsupported generation output');
    text+=string(part.text);
   }
  }
 }else text=string(response.output_text); // Preserve the existing injected SDK client contract.
 return boundedText(text);
}

function chatChoice(value:unknown):JsonObject{
 const response=object(value);
 if(response.error)throw new Error('Provider error');
 const choices=list(response.choices);
 if(choices.length!==1)throw new Error('Unexpected number of choices');
 const choice=object(choices[0]);
 if(choice.index!==undefined&&choice.index!==0)throw new Error('Unexpected choice index');
 return choice;
}
function chatResponseText(value:unknown):string{
 const choice=chatChoice(value);
 if(choice.finish_reason!=='stop')throw new Error('Incomplete generation');
 const message=object(choice.message);
 if(message.refusal||message.tool_calls||message.function_call)throw new Error('Refused or unsupported output');
 return boundedText(message.content);
}
function anthropicStructuredText(value:unknown):string{
 const response=object(value);
 if(response.type!=='message'||response.stop_reason!=='tool_use'||response.error)throw new Error('Incomplete structured generation');
 const content=list(response.content);
 if(content.length!==1)throw new Error('Expected exactly one structured result');
 const result=object(content[0]);
 if(result.type!=='tool_use'||result.name!=='orchestra_result'||typeof result.id!=='string'||!result.id)throw new Error('Unexpected structured result');
 // This tool is a result-format channel, not executable capability. No tool
 // dispatcher or follow-up tool_result request exists in the desktop adapter.
 return boundedText(JSON.stringify(object(result.input)));
}
function googleCandidate(value:unknown):JsonObject|null{
 const response=object(value);
 if(response.error||response.promptFeedback&&object(response.promptFeedback).blockReason)throw new Error('Blocked generation');
 const candidates=list(response.candidates??[]);
 // Some stream frames carry usage only. A successful terminal candidate is
 // required separately, so metadata can never turn an empty reply into success.
 if(candidates.length===0)return null;
 if(candidates.length!==1)throw new Error('Unexpected number of candidates');
 const candidate=object(candidates[0]);
 if(candidate.index!==undefined&&candidate.index!==0)throw new Error('Unexpected candidate index');
 if(candidate.safetyRatings&&list(candidate.safetyRatings).some(value=>object(value).blocked===true))throw new Error('Blocked generation');
 return candidate;
}
function googleParts(candidate:JsonObject):string{
 if(candidate.content===undefined)return '';
 return list(object(candidate.content).parts).map(value=>{
  const part=object(value);
  if(part.thought===true)return ''; // Internal thought is not answer text.
  if(typeof part.text!=='string')throw new Error('Unsupported output');
  return part.text;
 }).join('');
}
function googleResponseText(value:unknown):string{
 const candidate=googleCandidate(value);
 if(!candidate||candidate.finishReason!=='STOP')throw new Error('Incomplete generation');
 return boundedText(googleParts(candidate));
}

interface GenerationRequest {prompt:string;systemPrompt?:string;maxTokens:number;schema?:Record<string,unknown>}
function request(config:DesktopAi,input:GenerationRequest,stream:boolean){
 const provider=config.preferences.provider??'openai';
 const model=config.preferences.generationModel;
 let url=resolveDesktopGenerationEndpoint(config.preferences);
 let headers:Record<string,string>={Authorization:`Bearer ${config.apiKey}`};
 let body:Record<string,unknown>;
 switch(provider){
  case 'openai':body={model,input:input.prompt,instructions:input.systemPrompt,max_output_tokens:input.maxTokens,store:false,stream,
   ...(input.schema?{text:{format:{type:'json_schema',name:'orchestra_result',strict:true,schema:input.schema}}}:{})};break;
  case 'openai-compatible':body={model,messages:[...(input.systemPrompt?[{role:'system',content:input.systemPrompt}]:[]),{role:'user',content:input.prompt}],max_tokens:input.maxTokens,stream,
   ...(input.schema?{response_format:{type:'json_schema',json_schema:{name:'orchestra_result',strict:true,schema:input.schema}}}:{})};break;
  case 'anthropic':
   headers={'x-api-key':config.apiKey,'anthropic-version':'2023-06-01'};
   body={model,messages:[{role:'user',content:input.prompt}],system:input.systemPrompt,max_tokens:input.maxTokens,stream,
    // Non-strict native tool inputs support the richer product JSON Schema
    // without strict grammar union limits. Original Zod validation remains the
    // authority; this is explicit transport selection, never a retry/fallback.
    // https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
    ...(input.schema?{tools:[{name:'orchestra_result',description:'Return the requested structured result matching this schema. This is only a result-format channel; no external action will execute.',input_schema:input.schema}],tool_choice:{type:'tool',name:'orchestra_result',disable_parallel_tool_use:true}}:{})};break;
  case 'google':
   headers={'x-goog-api-key':config.apiKey};
   if(stream)url=url.replace(/:generateContent$/,':streamGenerateContent?alt=sse');
   body={contents:[{role:'user',parts:[{text:input.prompt}]}],
    ...(input.systemPrompt?{systemInstruction:{parts:[{text:input.systemPrompt}]}}:{}),
    generationConfig:{candidateCount:1,maxOutputTokens:input.maxTokens,...(input.schema?{responseMimeType:'application/json',responseJsonSchema:input.schema}:{})}};break;
 }
 return {provider,url,headers,body};
}

export async function generateDesktopText(config:DesktopAi,input:GenerationRequest,signal:AbortSignal):Promise<string>{
 const outgoing=request(config,input,false);
 const response=await postDesktopAi(outgoing.url,outgoing.headers,outgoing.body,signal);
 const value=await response.json();
 switch(outgoing.provider){
  case 'openai':return openAiResponseText(value);
  case 'openai-compatible':return chatResponseText(value);
  case 'anthropic':return anthropicStructuredText(value);
  case 'google':return googleResponseText(value);
 }
}

/** Native protocols are deliberately explicit. Unknown tool calls, refusals,
 * truncation, or a missing success marker are never treated as an answer. */
export async function consumeDesktopStream(provider:NonNullable<DesktopAi['preferences']['provider']>,events:AsyncIterable<unknown>,signal:AbortSignal,onDelta:(delta:string)=>void|Promise<void>,progress:()=>void):Promise<string>{
 let text='',completed=false,stopReason:unknown,anthropicStarted=false;
 const emit=async(value:unknown)=>{
  const delta=string(value);
  if(!delta)return;
  if(completed)throw new Error('Output after completion');
  text+=delta;
  if(Buffer.byteLength(text,'utf8')>131072)throw new Error('Output too large');
  progress();
  await onDelta(delta);
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
 };
 for await(const value of events){
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const event=object(value);
  if(event.error||event.type==='error')throw new Error('Provider error');
  switch(provider){
   case 'openai':
    if(event.type==='response.output_text.delta')await emit(event.delta);
    if(event.type==='response.completed'){
     // The terminal response is authoritative. Missing deltas are not silently
     // repaired: a truncated stream must not be persisted as a complete answer.
     if(completed||openAiResponseText(event.response)!==text)throw new Error('Stream does not match completed response');
     completed=true;
    }
    if(event.type==='response.incomplete'||event.type==='response.failed'||String(event.type).startsWith('response.refusal.'))throw new Error('Incomplete generation');
    break;
   case 'openai-compatible':{
    // A providers' optional usage-only frame has no choices.
    if(Array.isArray(event.choices)&&event.choices.length===0){if(!event.usage)throw new Error('Invalid stream frame');break;}
    const choice=chatChoice(event),delta=object(choice.delta);
    if(delta.refusal||delta.tool_calls||delta.function_call)throw new Error('Refused or unsupported output');
    if(choice.finish_reason!=null&&choice.finish_reason!=='stop')throw new Error('Incomplete generation');
    if(delta.content!=null)await emit(delta.content);
    if(choice.finish_reason==='stop')completed=true;
    break;
   }
   case 'anthropic':
    if(event.type==='message_start'){
     if(anthropicStarted)throw new Error('Duplicate message');
     anthropicStarted=true;
     const message=object(event.message);
     if(message.type!=='message')throw new Error('Invalid message');
    }
    if(event.type==='content_block_start'){
     const part=object(event.content_block);
     if(part.type!=='text')throw new Error('Unsupported content');
     if(part.text)await emit(part.text);
    }
    if(event.type==='content_block_delta'){
     const delta=object(event.delta);
     if(delta.type!=='text_delta')throw new Error('Unsupported delta');
     await emit(delta.text);
    }
    if(event.type==='message_delta'){
     const reason=object(event.delta).stop_reason;
     if(reason!=null){stopReason=reason;if(reason!=='end_turn')throw new Error('Incomplete generation');}
    }
    if(event.type==='message_stop'){
     if(!anthropicStarted||stopReason!=='end_turn')throw new Error('Incomplete generation');
     completed=true;
    }
    break;
   case 'google':{
    const candidate=googleCandidate(event);
    if(!candidate)break;
    if(candidate.finishReason!=null&&candidate.finishReason!=='STOP')throw new Error('Incomplete generation');
    await emit(googleParts(candidate));
    if(candidate.finishReason==='STOP')completed=true;
    break;
   }
  }
 }
 if(!completed)throw new Error('Incomplete generation');
 return boundedText(text);
}

export async function streamDesktopText(config:DesktopAi,input:GenerationRequest,signal:AbortSignal,onDelta:(delta:string)=>void|Promise<void>,progress:()=>void):Promise<string>{
 const outgoing=request(config,input,true);
 const response=await postDesktopAi(outgoing.url,outgoing.headers,outgoing.body,signal);
 return consumeDesktopStream(outgoing.provider,response.events(),signal,onDelta,progress);
}
