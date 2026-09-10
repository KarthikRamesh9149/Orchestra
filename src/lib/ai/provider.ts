import { z } from "zod";

export interface GenerationInput<TSchema extends z.ZodTypeAny> {
  prompt: string;
  schema: TSchema;
  systemPrompt?: string;
  fallback: () => z.infer<TSchema>;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  task?: string;
  telemetry?: Record<string, unknown>;
}

export interface TextStreamInput {
  prompt: string;
  systemPrompt?: string;
  fallback: () => string;
  onDelta: (delta: string) => void | Promise<void>;
  signal?: AbortSignal;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  task?: string;
  telemetry?: Record<string, unknown>;
}

export interface GenerationProvider {
  generateObject<TSchema extends z.ZodTypeAny>(input: GenerationInput<TSchema>): Promise<z.infer<TSchema>>;
  streamText?(input: TextStreamInput): Promise<string>;
}

export interface EmbeddingProvider {
  readonly unavailable?: boolean;
  embedText(input: string): Promise<number[]>;
}

export interface TranscriptionProvider {
  transcribeAudio(input: {
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }): Promise<{
    text: string;
    provider: string;
  }>;
}
