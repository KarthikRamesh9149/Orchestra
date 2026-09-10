import { AppError } from "../../app/errors.js";
import type { EmbeddingProvider, GenerationProvider, GenerationInput, TranscriptionProvider } from "./provider.js";
import type { z } from "zod";

export class OfflineGenerationProvider implements GenerationProvider {
  async generateObject<T extends z.ZodTypeAny>(_input: GenerationInput<T>): Promise<z.infer<T>> {
    throw new AppError(503,"Configure an AI provider to generate content. Indexed evidence remains available.","ai_not_configured");
  }
}
export class OfflineEmbeddingProvider implements EmbeddingProvider {
  readonly unavailable = true;
  async embedText(_text:string):Promise<number[]> { throw new AppError(503,"Semantic search is unavailable; use lexical evidence search.","embedding_not_configured"); }
}
export class OfflineTranscriptionProvider implements TranscriptionProvider {
  async transcribeAudio():Promise<{text:string;provider:string}>{ throw new AppError(503,"Configure transcription before importing audio.","transcription_not_configured"); }
}
