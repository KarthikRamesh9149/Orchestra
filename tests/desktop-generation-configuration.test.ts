import {describe,expect,it} from 'vitest';
import {configuredGenerationProvider,hasConfiguredGeneration} from '../src/lib/ai/configuration.js';
import {getModelForTask} from '../src/lib/ai-ops/ai-model-strategy.js';

describe('desktop provider-aware generation readiness',()=>{
  it.each(['openai','openai-compatible','anthropic','google'] as const)('uses configured %s without requiring a different vendor key',provider=>{
    const env={RUNTIME_PROFILE:'desktop-local',DESKTOP_AI_PROVIDER:provider,SOCRATES_MODEL:'chosen-model'};
    expect(hasConfiguredGeneration(env)).toBe(true);
    expect(getModelForTask('socrates_answer',{},env)).toMatchObject({provider,model:'chosen-model'});
  });
  it('does not infer desktop authority from an inherited environment key',()=>{
    expect(hasConfiguredGeneration({RUNTIME_PROFILE:'desktop-local',OPENAI_API_KEY:'synthetic-not-configured'})).toBe(false);
  });
  it('retains the hosted provider contract and ignores desktop flags there',()=>{
    expect(configuredGenerationProvider({RUNTIME_PROFILE:'managed',DESKTOP_AI_PROVIDER:'anthropic'})).toBeNull();
    expect(configuredGenerationProvider({RUNTIME_PROFILE:'managed',OPENAI_API_KEY:'synthetic-hosted-key'})).toBe('openai');
  });
  it('does not label deterministic output as an external model response',()=>{
    expect(getModelForTask('socrates_answer',{}, {RUNTIME_PROFILE:'desktop-local',DESKTOP_AI_PROVIDER:'google',SOCRATES_MODEL_STRATEGY:'deterministic'}).provider).toBe('deterministic');
  });
});
