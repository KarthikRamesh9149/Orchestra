import type { AppEnv } from "../../config/env.js";
import { MockEmbeddingProvider, MockGenerationProvider, MockTranscriptionProvider } from "./mock.js";
import { OpenAiEmbeddingProvider } from "./openai-embeddings.js";
import { OpenAiGenerationProvider } from "./openai-generation.js";
import { OpenAiTranscriptionProvider } from "./openai-transcription.js";
import { OfflineGenerationProvider, OfflineEmbeddingProvider, OfflineTranscriptionProvider } from "./offline.js";

export function createGenerationProvider(env: AppEnv) {
  if (env.OPENAI_API_KEY) {
    return new OpenAiGenerationProvider(env);
  }

  return env.RUNTIME_PROFILE === 'self-hosted' ? new OfflineGenerationProvider() : new MockGenerationProvider();
}

export function createEmbeddingProvider(env: AppEnv) {
  if (env.OPENAI_API_KEY) {
    return new OpenAiEmbeddingProvider(env);
  }

  return env.RUNTIME_PROFILE === 'self-hosted' ? new OfflineEmbeddingProvider() : new MockEmbeddingProvider();
}

export function createTranscriptionProvider(env: AppEnv) {
  if (env.OPENAI_API_KEY) {
    return new OpenAiTranscriptionProvider(env);
  }

  return env.RUNTIME_PROFILE === 'self-hosted' ? new OfflineTranscriptionProvider() : new MockTranscriptionProvider();
}
