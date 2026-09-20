import {describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {zodTextFormat} from 'openai/helpers/zod';
import {getDesktopProductWireSchema} from '../src/desktop/ai-product-schemas.js';
import {DesktopAiProvider,type DesktopAi} from '../src/desktop/ai-provider.js';
import type {createOpenAiClient} from '../src/lib/ai/openai-client.js';
import {actionPayloadSchemas,type SocratesActionTypeInput} from '../src/modules/socrates/actions.schemas.js';
import {answerSchema} from '../src/modules/socrates/schemas.js';

type JsonSchema=Record<string,any>;
const id='00000000-0000-4000-8000-000000000001';
const payloads:Record<SocratesActionTypeInput,unknown>={
 generate_prd:{prompt:'Generate a synthetic product requirements document.'},
 generate_srs:{prompt:'Generate a synthetic software requirements document.'},
 create_context_note:{type:'manual_note',title:'Synthetic note',body:'Synthetic evidence only.'},
 create_diagram:{mode:'generate',diagramType:'flowchart',prompt:'Show the synthetic review process.'},
 embed_diagram_in_live_doc:{diagramId:id,sectionKey:'overview'},
 generate_coding_requirements:{focus:'backend'},
 create_responsibility:{assigneeName:'Synthetic reviewer',title:'Review evidence',area:'qa'},
 assign_task:{assigneeName:'Synthetic reviewer',taskTitle:'Review evidence',area:'qa'},
 update_team_member_responsibility:{responsibilityId:id,status:'in_progress'},
 create_calendar_event:{title:'Synthetic review',startsAt:'2026-09-20T09:00:00Z'}
};
const types=Object.keys(payloads) as SocratesActionTypeInput[];
function answer(type:SocratesActionTypeInput='assign_task',payload:unknown=payloads[type]){
 return {answer_md:'This is a suggestion, not an approved action.',citations:[],open_targets:[],suggested_prompts:[],suggested_actions:[{type,label:'Review synthetic evidence',payload,confidence:'medium',requiresConfirmation:true}],confidence:'medium',limitations:[]};
}
function dereference(schema:JsonSchema,root:JsonSchema,seen=new Set<string>()):JsonSchema{
 if(typeof schema.$ref!=='string')return schema;
 expect(schema.$ref.startsWith('#/')).toBe(true);
 expect(seen.has(schema.$ref),`cyclic schema reference: ${schema.$ref}`).toBe(false);
 seen.add(schema.$ref);
 const target=schema.$ref.slice(2).split('/').reduce((node:JsonSchema,key:string)=>node[key.replace(/~1/g,'/').replace(/~0/g,'~')],root);
 return dereference(target,root,seen);
}
function expectAcyclicReferences(value:unknown,root:JsonSchema){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){for(const child of value)expectAcyclicReferences(child,root);return;}
 dereference(value,root);
 for(const child of Object.values(value))expectAcyclicReferences(child,root);
}
function wireActions(root:JsonSchema):JsonSchema[]{
 const actions=dereference(root.properties.suggested_actions,root);
 return dereference(actions.items,root).anyOf.map((variant:JsonSchema)=>dereference(variant,root));
}
function expectConcretePayload(schema:JsonSchema,root:JsonSchema){
 const value=dereference(schema,root);
 expect(Object.keys(value).length).toBeGreaterThan(0);
 if(value.anyOf){for(const branch of value.anyOf)expectConcretePayload(branch,root);return;}
 expect(value.type).toBe('object');
 expect(value.additionalProperties).toBe(false);
 expect(Object.keys(value.properties).length).toBeGreaterThan(0);
}
function expectStrictObjects(value:unknown,root:JsonSchema){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){for(const child of value)expectStrictObjects(child,root);return;}
 const schema=value as JsonSchema;
 expect(schema).not.toHaveProperty('default');
 expect(schema).not.toHaveProperty('nullable');
 if(schema.type==='object'){
  expect(schema.additionalProperties).toBe(false);
  expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
 }
 for(const child of Object.values(value))expectStrictObjects(child,root);
}
// Make provider-shaped fixtures: domain defaults first, then explicit null only
// for absent optional properties represented by a nullable wire branch.
function explicitWireValue(input:unknown,schema:JsonSchema,root:JsonSchema):unknown{
 const value=dereference(schema,root);
 if(value.anyOf){
  if(input===undefined||input===null){expect(value.anyOf.some((branch:JsonSchema)=>dereference(branch,root).type==='null')).toBe(true);return null;}
  const branch=value.anyOf.find((candidate:JsonSchema)=>{
   const choice=dereference(candidate,root);
   if(choice.type==='null')return false;
   if(choice.type!=='object')return true;
   return Object.entries(choice.properties).every(([key,property])=>{
    const field=dereference(property as JsonSchema,root);
    return field.const===undefined||(input as Record<string,unknown>)[key]===field.const;
   });
  });
  expect(branch).toBeDefined();return explicitWireValue(input,branch,root);
 }
 if(value.type==='object')return Object.fromEntries(Object.entries(value.properties).map(([key,property])=>[key,explicitWireValue((input as Record<string,unknown>)[key],property as JsonSchema,root)]));
 if(value.type==='array')return (input as unknown[]).map(item=>explicitWireValue(item,value.items,root));
 expect(input).not.toBeUndefined();return input;
}
function wireAnswer(type:SocratesActionTypeInput='assign_task',payload:unknown=payloads[type]):ReturnType<typeof answer>{
 const root=zodTextFormat(getDesktopProductWireSchema(answerSchema),'orchestra_result').schema as JsonSchema;
 return explicitWireValue(answer(type,actionPayloadSchemas[type].parse(payload)),root,root) as ReturnType<typeof answer>;
}
const config:DesktopAi={apiKey:'synthetic-key-for-tests-only',preferences:{generationModel:'test-model',embeddingProvider:'none',embeddingModel:'text-embedding-3-small',embeddingDimensions:1536,maxRequestsPerDay:20,maxOutputTokens:1024}};
function provider(value:unknown){
 const create=vi.fn().mockResolvedValue({status:'completed',output_text:JSON.stringify(value)});
 const client={responses:{create}} as unknown as ReturnType<typeof createOpenAiClient>;
 return {create,provider:new DesktopAiProvider(config,{checkRequestLimit:async()=>({allowed:true,code:'allowed',remaining:10})},client)};
}

describe('desktop product wire schemas',()=>{
 it('converts the actual answer schema into all ten typed suggestion variants without changing the public schema',()=>{
  const original=zodTextFormat(answerSchema,'orchestra_result').schema as JsonSchema;
  const wire=getDesktopProductWireSchema(answerSchema);
  const converted=zodTextFormat(wire,'orchestra_result').schema as JsonSchema;
  const variants=wireActions(converted);
  expectAcyclicReferences(converted,converted);
  expectStrictObjects(converted,converted);
  expect(variants.map(variant=>variant.properties.type.const).sort()).toEqual(Object.keys(actionPayloadSchemas).sort());
  for(const variant of variants){
   expect(variant.additionalProperties).toBe(false);
   expectConcretePayload(variant.properties.payload,converted);
   expect(dereference(variant.properties.label,converted).type).toBe('string');
   expect(variant.properties.confidence).toBeDefined();
   expect(dereference(variant.properties.requiresConfirmation,converted)).toMatchObject({type:'boolean',const:true});
  }
  expect(zodTextFormat(answerSchema,'orchestra_result').schema).toEqual(original);
  expect(wire).not.toBe(answerSchema);
 });
 it.each(types)('retains original validation and confirmation for %s',type=>{
  const value=wireAnswer(type);
  const normalized=getDesktopProductWireSchema(answerSchema).parse(value);
  expect(answerSchema.parse(normalized).suggested_actions[0]).toMatchObject({type,label:'Review synthetic evidence',confidence:'medium',requiresConfirmation:true});
  const unconfirmed=answer(type);unconfirmed.suggested_actions[0].requiresConfirmation=false;
  expect(answerSchema.safeParse(unconfirmed).success).toBe(false);
 });
 it('retains both diagram payload modes and their original Mermaid validation',()=>{
  const value=wireAnswer('create_diagram',{mode:'save',diagramType:'flowchart',title:'Synthetic flow',mermaidSource:'flowchart TD\n  A --> B'});
  expect(answerSchema.safeParse(getDesktopProductWireSchema(answerSchema).parse(value)).success).toBe(true);
 });
 it('does not substitute unrelated or cloned public schemas',()=>{
  const unrelated=z.object({payload:z.unknown()}),copy=answerSchema.extend({});
  expect(getDesktopProductWireSchema(unrelated)).toBe(unrelated);
  expect(getDesktopProductWireSchema(copy)).toBe(copy);
 });
 it('uses the typed wire schema in generation while returning the original validated answer',async()=>{
  const value=wireAnswer();
  value.citations=[{type:'document_chunk',refId:'synthetic-chunk',label:'Evidence',pageNumber:null,confidence:null}] as never[];
  const state=provider(value),fallback=vi.fn();
  await expect(state.provider.generateObject({prompt:'Suggest a synthetic action.',schema:answerSchema,fallback})).resolves.toEqual(answerSchema.parse(getDesktopProductWireSchema(answerSchema).parse(value)));
  expect(wireActions(state.create.mock.calls[0][0].text.format.schema)).toHaveLength(types.length);
  expect(fallback).not.toHaveBeenCalled();
 });
 it('normalizes only declared nonnullable optional fields while retaining intentional domain nulls',()=>{
  const value=wireAnswer();
  const root=zodTextFormat(getDesktopProductWireSchema(answerSchema),'orchestra_result').schema as JsonSchema;
  value.citations=explicitWireValue([{type:'document_chunk',refId:'synthetic-chunk',label:'Evidence'}],root.properties.citations,root) as never[];
  const result=answerSchema.parse(getDesktopProductWireSchema(answerSchema).parse(value));
  expect(result.citations[0].pageNumber).toBeUndefined();
  expect(result.citations[0].confidence).toBeUndefined();
  expect(result.suggested_actions[0].payload).toMatchObject({memberId:null,taskDescription:null});
  const invalid={...value,answer_md:null};
  expect(()=>getDesktopProductWireSchema(answerSchema).parse(invalid)).toThrow();
 });
 it.each(['secret key','secret value','mismatched action payload','missing responsibility owner','calendar cross-field violation'])('rejects %s after a nominally completed provider response',async name=>{
  const value=wireAnswer(name==='calendar cross-field violation'?'create_calendar_event':name==='missing responsibility owner'?'create_responsibility':'assign_task');
  const payload=value.suggested_actions[0].payload as Record<string,unknown>;
  if(name==='secret key')payload.apiKey='synthetic-hidden-key';
  if(name==='secret value')payload.taskTitle='Bearer synthetic-secret-value-long-enough';
  if(name==='mismatched action payload')value.suggested_actions[0].payload=wireAnswer('create_calendar_event').suggested_actions[0].payload;
  if(name==='missing responsibility owner'){payload.memberId=null;payload.assigneeName=null;}
  if(name==='calendar cross-field violation')payload.endsAt='2026-09-20T08:00:00Z';
  expect(answerSchema.safeParse(value).success).toBe(false);
  if(['secret value','missing responsibility owner','calendar cross-field violation'].includes(name)){
   // These guards are not expressible in JSON Schema. They must still be
   // rejected by the original validator after successful wire normalization.
   const normalized=getDesktopProductWireSchema(answerSchema).parse(value);
   expect(answerSchema.safeParse(normalized).success).toBe(false);
  }
  const state=provider(value),fallback=vi.fn();
  await expect(state.provider.generateObject({prompt:'Suggest a synthetic action.',schema:answerSchema,fallback})).rejects.toMatchObject({code:'ai_provider_failed'});
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(fallback).not.toHaveBeenCalled();
 });
});
