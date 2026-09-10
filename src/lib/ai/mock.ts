import { z } from "zod";
import type {
  EmbeddingProvider,
  GenerationInput,
  GenerationProvider,
  TextStreamInput,
  TranscriptionProvider
} from "./provider.js";

const EMBEDDING_DIMENSIONS = 1536;

export class MockGenerationProvider implements GenerationProvider {
  async generateObject<TSchema extends z.ZodTypeAny>(input: GenerationInput<TSchema>) {
    return input.schema.parse(input.fallback());
  }


  async streamText(input: TextStreamInput) {
    if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
    const text = input.fallback();
    await input.onDelta(text);
    return text;
  }
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  async embedText(input: string) {
    const values = Array.from(
      { length: EMBEDDING_DIMENSIONS },
      (_, index) => ((input.charCodeAt(index % Math.max(input.length, 1)) || 7) % 13) / 13
    );
    return values;
  }
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  async transcribeAudio(input: { fileName: string; contentType: string; buffer: Buffer }) {
    const text = input.buffer.toString("utf8").trim();
    if (!text) {
      return {
        text: `Voice note transcript placeholder for ${input.fileName} (${input.contentType}).`,
        provider: "mock"
      };
    }

    return {
      text,
      provider: "mock"
    };
  }
}
