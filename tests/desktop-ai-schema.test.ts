import {beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {zodTextFormat} from 'openai/helpers/zod';
import {compactDesktopWireSchema} from '../src/desktop/ai-schema.js';
import {getDesktopProductWireSchema} from '../src/desktop/ai-product-schemas.js';
import {DesktopAiProvider,desktopAiConnectionSample,testDesktopAiConnection} from '../src/desktop/ai-provider.js';
import {deepResearchStructuredSchema} from '../src/modules/deep-research/schemas.js';
import {answerSchema,citationSchema} from '../src/modules/socrates/schemas.js';
import {postDesktopAi} from '../src/desktop/ai-http.js';

vi.mock('../src/desktop/ai-http.js',async importOriginal=>({...await importOriginal<typeof import('../src/desktop/ai-http.js')>(),postDesktopAi:vi.fn()}));
const post=vi.mocked(postDesktopAi);
const config={apiKey:'synthetic-anthropic-key',preferences:{provider:'anthropic' as const,generationModel:'test-model',embeddingProvider:'none' as const,embeddingModel:'text-embedding-3-small',embeddingDimensions:1536 as const,maxRequestsPerDay:10,maxOutputTokens:128}};
function provider(){return new DesktopAiProvider(config,{checkRequestLimit:()=>({allowed:true,code:'allowed'})});}
const resultBlock=(input:unknown)=>({type:'tool_use',id:'synthetic-result-id',name:'orchestra_result',input});
function rawReply(value:unknown){post.mockResolvedValue({json:async()=>value,events:async function*(){}});}
function reply(value:unknown){rawReply({type:'message',stop_reason:'tool_use',content:[resultBlock(value)]});}
function transmitted(){return (post.mock.calls.at(-1)![2] as {tools:{input_schema:Record<string,any>}[]}).tools[0].input_schema;}
beforeEach(()=>{post.mockReset();});

describe('verified SDK root-definition compaction',()=>{
 it('removes only a structurally identical root and repairs references without mutating literals',()=>{
  const root={type:'object',properties:{value:{type:'string',default:{$ref:'#/definitions/orchestra_result'}},alias:{$ref:'#/definitions/orchestra_result/properties/value'},other:{$ref:'#/definitions/orchestra_result_other'}}};
  const schema={...root,$schema:'https://json-schema.org/draft-07/schema#',definitions:{orchestra_result:structuredClone(root),orchestra_result_other:{type:'number'}}};
  const before=JSON.stringify(schema),compact=compactDesktopWireSchema(schema) as Record<string,any>;
  expect(compact.definitions).toEqual({orchestra_result_other:{type:'number'}});
  expect(compact.properties.alias.$ref).toBe('#/properties/value');
  expect(compact.properties.other.$ref).toBe('#/definitions/orchestra_result_other');
  expect(compact.properties.value.default).toEqual({$ref:'#/definitions/orchestra_result'});
  expect(JSON.stringify(schema)).toBe(before);
 });
 it('leaves distinct definitions and scoped references unchanged',()=>{
  const different={type:'string',definitions:{orchestra_result:{type:'number'}}};expect(compactDesktopWireSchema(different)).toBe(different);
  const root={type:'object',properties:{value:{$id:'https://example.com/schema',type:'string'}}};
  const scoped={...root,definitions:{orchestra_result:structuredClone(root)}};expect(compactDesktopWireSchema(scoped)).toBe(scoped);
 });
 it('compacts the actual mapped Socrates schema before request-size accounting',()=>{
  const original=zodTextFormat(getDesktopProductWireSchema(answerSchema),'orchestra_result').schema;
  const compact=compactDesktopWireSchema(original) as Record<string,any>;
  expect(compact.definitions?.orchestra_result).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(Buffer.byteLength(JSON.stringify(original))*.7);
  expect(compact.properties.suggested_actions).toBeDefined();
 });
});

describe('Anthropic native structured result channel',()=>{
 it('uses one forced non-strict result tool with the complete nested research schema',async()=>{
  const result={...desktopAiConnectionSample.report,findings:[{category:'Delivery',severity:'MEDIUM',title:'Evidence',description:'Grounded in E1.',sources:'E1'}]};reply(result);
  await expect(provider().generateObject({prompt:'Synthetic evidence E1.',schema:deepResearchStructuredSchema,fallback:()=>{throw new Error('No fallback');}})).resolves.toEqual(result);
  const request=post.mock.calls[0][2] as Record<string,any>;
  expect(request).toMatchObject({tool_choice:{type:'tool',name:'orchestra_result',disable_parallel_tool_use:true}});
  expect(request.tools).toHaveLength(1);expect(request.tools[0].name).toBe('orchestra_result');
  expect(request.tools[0]).not.toHaveProperty('strict');expect(request).not.toHaveProperty('output_config');
  expect(transmitted().properties.executiveSummary).toMatchObject({minLength:1,maxLength:4000});
  expect(transmitted().properties.findings).toMatchObject({maxItems:12});
  expect(transmitted().properties.findings.items.properties.title).toMatchObject({minLength:1,maxLength:240});
  expect(post).toHaveBeenCalledTimes(1);
 });
 it('sends the full typed Socrates schema without strict grammar union limits',async()=>{
  const result={answer_md:'Synthetic evidence checked.',citations:[],open_targets:[],suggested_prompts:[],suggested_actions:[],confidence:'medium',limitations:[]};reply(result);
  await expect(provider().generateObject({prompt:'Synthetic evidence.',schema:answerSchema,fallback:()=>{throw new Error('No fallback');}})).resolves.toEqual(result);
  const schema=transmitted();expect(schema.properties.open_targets.items.anyOf).toHaveLength(21);
  expect(schema.properties.suggested_actions.items.anyOf).toHaveLength(10);
  expect(schema.definitions?.orchestra_result).toBeUndefined();
  expect((JSON.stringify(schema).match(/"anyOf"/g)??[]).length).toBeGreaterThan(16);
  expect(post).toHaveBeenCalledTimes(1);
 });
 it.each([
  {executiveSummary:''},
  {findings:Array(13).fill({category:'Delivery',severity:'MEDIUM',title:'Evidence',description:'Grounded.',sources:'E1'})},
  {findings:[{category:'Delivery',severity:'MEDIUM',title:'x'.repeat(241),description:'Grounded.',sources:'E1'}]}
 ])('rejects invalid research inputs using original product constraints',async change=>{
  reply({...desktopAiConnectionSample.report,...change});const fallback=vi.fn();
  await expect(provider().generateObject({prompt:'Synthetic evidence.',schema:deepResearchStructuredSchema,fallback})).rejects.toMatchObject({code:'ai_provider_failed'});expect(fallback).not.toHaveBeenCalled();expect(post).toHaveBeenCalledTimes(1);
 });
 it('rejects real Socrates numeric constraints after a completed result',async()=>{
  reply({type:'document_chunk',refId:'E1',label:'Synthetic',confidence:2});
  await expect(provider().generateObject({prompt:'Synthetic evidence.',schema:citationSchema,fallback:()=>{throw new Error('No fallback');}})).rejects.toMatchObject({code:'ai_provider_failed'});
  expect(transmitted().properties.confidence).toMatchObject({minimum:0,maximum:1});
 });
 it.each([
  {type:'message',stop_reason:'end_turn',content:[{type:'text',text:'{"ok":true}'}]},
  {type:'message',stop_reason:'tool_use',content:[]},
  {type:'message',stop_reason:'tool_use',content:[resultBlock({ok:true}),resultBlock({ok:true})]},
  {type:'message',stop_reason:'tool_use',content:[{...resultBlock({ok:true}),name:'execute_action'}]},
  {type:'message',stop_reason:'tool_use',content:[{...resultBlock({ok:true}),id:''}]},
  {type:'message',stop_reason:'tool_use',content:[resultBlock('{"ok":true}')]},
  {type:'message',stop_reason:'tool_use',content:[{type:'text',text:'Narration'},resultBlock({ok:true})]},
  {type:'message',stop_reason:'refusal',content:[resultBlock({ok:true})]},
  {type:'message',stop_reason:'max_tokens',content:[resultBlock({ok:true})]}
 ])('rejects missing, foreign, multiple, textual, refused and truncated results',async value=>{
  rawReply(value);const fallback=vi.fn();
  await expect(provider().generateObject({prompt:'Synthetic question.',schema:z.object({ok:z.boolean()}),fallback})).rejects.toMatchObject({code:'ai_provider_failed'});
  expect(fallback).not.toHaveBeenCalled();expect(post).toHaveBeenCalledTimes(1);
 });
 it('onboarding exercises research output and honours configured allowance',async()=>{
  reply(desktopAiConnectionSample);await expect(testDesktopAiConnection({...config,preferences:{...config.preferences,maxOutputTokens:2048}})).resolves.toBeUndefined();
  expect(post).toHaveBeenCalledTimes(1);expect(transmitted().properties.report.properties.findings.items.properties.title).toMatchObject({maxLength:240});
  expect(transmitted().properties.confidence).toMatchObject({minimum:0,maximum:1});
  expect((post.mock.calls[0][2] as {max_tokens:number}).max_tokens).toBe(2048);
 });
 it('onboarding rejects the old trivial boolean response',async()=>{
  reply({ok:true});await expect(testDesktopAiConnection(config)).rejects.toMatchObject({code:'ai_provider_failed'});expect(post).toHaveBeenCalledTimes(1);
 });
 it('does not preprocess unrelated schemas twice or remove declared nulls',async()=>{
  const preprocess=vi.fn(value=>value);
  const schema=z.preprocess(preprocess,z.object({meaningful:z.string().nullable()}));reply({meaningful:null});
  await expect(provider().generateObject({prompt:'Synthetic input.',schema,fallback:()=>({meaningful:'not used'})})).resolves.toEqual({meaningful:null});
  expect(preprocess).toHaveBeenCalledTimes(1);
 });
});
