import {describe,expect,it,vi} from 'vitest';
import {AiSettingsSession,aiKeyImportSchema,desktopAiSearchStatus} from '../apps/desktop/src/ai-settings-session.js';
import type {DesktopAi,DesktopAiPreferences} from '../src/desktop/ai-config.js';

const preferences:DesktopAiPreferences={generationModel:'gpt-test',embeddingModel:'text-embedding-3-small',embeddingDimensions:1536,maxRequestsPerDay:50,maxOutputTokens:2048};
const saved:DesktopAi={apiKey:'synthetic-existing-key',preferences};
describe('main-owned AI setup draft',()=>{
 it('projects persistent engine capability without leaking unrelated bootstrap fields',()=>{
  expect(desktopAiSearchStatus({ok:true,data:{semanticSearchAvailable:false,semanticSearchReason:'embedding_reindex_required',user:{id:'local-user'},workspaces:[],unexpectedSecret:'synthetic-not-for-renderer'}})).toEqual({semanticSearchAvailable:false,semanticSearchReason:'embedding_reindex_required'});
  expect(desktopAiSearchStatus({ok:true,data:{semanticSearchAvailable:false,semanticSearchReason:'not_configured'}})).toEqual({semanticSearchAvailable:false,semanticSearchReason:'not_configured'});
  expect(desktopAiSearchStatus({ok:true,data:{semanticSearchAvailable:true,semanticSearchReason:null}})).toEqual({semanticSearchAvailable:true,semanticSearchReason:null});
 });
 it('does not infer semantic readiness from failed, incomplete or inconsistent runtime status',()=>{
  const unavailable={semanticSearchAvailable:null,semanticSearchReason:'runtime_unavailable'};
  expect(desktopAiSearchStatus({ok:false,error:{code:'runtime_unavailable',message:'Unavailable'}})).toEqual(unavailable);
  for(const data of [{aiConfigured:true},{semanticSearchAvailable:true,semanticSearchReason:'embedding_reindex_required'},{semanticSearchAvailable:false,semanticSearchReason:null}])expect(desktopAiSearchStatus({ok:true,data})).toEqual(unavailable);
 });
 it('permits secure key import before model selection, but rejects unsafe selected destinations',()=>{
  const input={target:'generation',preferences:{...preferences,provider:'openai-compatible',baseUrl:'https://api.example.com/v1',generationModel:''}};
  expect(aiKeyImportSchema.parse(input).preferences).toMatchObject({provider:'openai-compatible',baseUrl:'https://api.example.com/v1',generationModel:'credential-import',embeddingProvider:'none'});
  for(const baseUrl of ['http://api.example.com/v1','https://secret@api.example.com/v1','https://api.example.com/v1?key=secret','https://127.0.0.1/v1'])expect(aiKeyImportSchema.safeParse({...input,preferences:{...input.preferences,baseUrl}}).success).toBe(false);
  expect(aiKeyImportSchema.safeParse({...input,apiKey:'never-accept-a-renderer-key'}).success).toBe(false);
 });
 it('validates the separate embedding key destination without depending on generation model selection',()=>{
  const selected=aiKeyImportSchema.parse({target:'embedding',preferences:{...preferences,provider:'anthropic',generationModel:'',embeddingProvider:'openai-compatible',embeddingBaseUrl:'https://embeddings.example.com/v1'}});
  expect(selected.preferences).toMatchObject({embeddingProvider:'openai-compatible',embeddingBaseUrl:'https://embeddings.example.com/v1'});
  const draft=new AiSettingsSession();draft.importKey(selected.target,selected.preferences,'synthetic-embedding-key');
  const config:DesktopAiPreferences={...preferences,provider:'anthropic',embeddingProvider:'openai-compatible',embeddingBaseUrl:'https://embeddings.example.com/v1'};
  draft.importKey('generation',config,'synthetic-generation-key');
  expect(draft.configuration(config,null).embeddingApiKey).toBe('synthetic-embedding-key');
 });
 it('requires a successful test of exact settings before saving',async()=>{
  const draft=new AiSettingsSession();draft.importKey('generation',preferences,'synthetic-imported-key');
  expect(()=>draft.confirmed(preferences,null)).toThrow();
  const test=vi.fn().mockResolvedValue(undefined);await draft.test(preferences,null,test);
  expect(test).toHaveBeenCalledWith({apiKey:'synthetic-imported-key',preferences});
  expect(draft.confirmed(preferences,null).apiKey).toBe('synthetic-imported-key');
  expect(()=>draft.confirmed({...preferences,generationModel:'other-model'},null)).toThrow();
  expect(()=>draft.confirmed({...preferences,maxRequestsPerDay:51},null)).toThrow();
 });
 it('preserves legacy credentials for same-provider model changes without importing again',async()=>{
  const draft=new AiSettingsSession(),updated={...preferences,generationModel:'vendor/model+revision'};
  await draft.test(updated,saved,async()=>{});
  expect(draft.confirmed(updated,saved)).toEqual({...saved,preferences:updated});
 });
 it('never reuses a saved or pending key for a different provider or endpoint',()=>{
  const draft=new AiSettingsSession();draft.importKey('generation',preferences,'synthetic-pending-key');
  expect(()=>draft.configuration({...preferences,provider:'anthropic'},saved)).toThrow();
  const compatible:DesktopAiPreferences={...preferences,provider:'openai-compatible',baseUrl:'https://api.example.com/v1',embeddingProvider:'none'};
  draft.importKey('generation',compatible,'synthetic-compatible-key');
  expect(draft.configuration(compatible,saved).apiKey).toBe('synthetic-compatible-key');
  expect(()=>draft.configuration({...compatible,baseUrl:'https://another.example.com/v1'},saved)).toThrow();
 });
 it('keeps generation and embedding credentials separate and supports lexical-only generation',()=>{
  const draft=new AiSettingsSession(),anthropic:DesktopAiPreferences={...preferences,provider:'anthropic',embeddingProvider:'none'};
  draft.importKey('generation',anthropic,'synthetic-generation-key');
  expect(draft.configuration(anthropic,null).embeddingApiKey).toBeUndefined();
  const embedded:DesktopAiPreferences={...anthropic,embeddingProvider:'openai'};
  expect(()=>draft.configuration(embedded,null)).toThrow();
  draft.importKey('embedding',embedded,'synthetic-embedding-key');
  expect(draft.configuration(embedded,null)).toMatchObject({apiKey:'synthetic-generation-key',embeddingApiKey:'synthetic-embedding-key'});
  draft.clear('embedding');expect(draft.configuration(anthropic,null).apiKey).toBe('synthetic-generation-key');
  expect(()=>draft.configuration(embedded,null)).toThrow();
 });
 it('replacing an OpenAI generation key also replaces the implicitly shared embedding key',()=>{
  const draft=new AiSettingsSession();draft.importKey('generation',preferences,'synthetic-new-key');
  expect(draft.configuration(preferences,saved)).toEqual({apiKey:'synthetic-new-key',preferences});
  expect(draft.configuration(preferences,{...saved,embeddingApiKey:'synthetic-old-separate-key'})).toEqual({apiKey:'synthetic-new-key',preferences});
 });
 it('failed tests, key replacement, draft removal and expiry invalidate save',async()=>{
  let time=100;const draft=new AiSettingsSession(()=>time);
  await draft.test(preferences,saved,async()=>{});
  await expect(draft.test(preferences,saved,async()=>{throw new Error('Synthetic provider failure');})).rejects.toThrow();
  expect(()=>draft.confirmed(preferences,saved)).toThrow();
  await draft.test(preferences,saved,async()=>{});draft.importKey('generation',preferences,'synthetic-new-key');
  expect(()=>draft.confirmed(preferences,saved)).toThrow();
  await draft.test(preferences,saved,async()=>{});expect(()=>draft.importKey('generation',preferences,'invalid key')).toThrow();
  expect(()=>draft.confirmed(preferences,saved)).toThrow();
  await draft.test(preferences,saved,async()=>{});time+=15*60*1000;
  expect(()=>draft.confirmed(preferences,saved)).toThrow();
  draft.clear();expect(()=>draft.configuration(preferences,null)).toThrow();
 });
 it('rejects control characters, whitespace and missing credentials',()=>{
  const draft=new AiSettingsSession();
  for(const key of ['', 'short', 'synthetic\nkey', 'synthetic key','x'.repeat(4097)])expect(()=>draft.importKey('generation',preferences,key)).toThrow();
 });
});
