import OpenAI from "openai";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import { createOpenAiClient } from "./openai-client.js";
import type { EmbeddingProvider } from "./provider.js";

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(private readonly env: AppEnv) {
    this.client = createOpenAiClient({ apiKey: env.OPENAI_API_KEY });
  }

  async embedText(input: string) {
    try {
      const response = await this.client.embeddings.create({
        model: this.env.OPENAI_EMBEDDING_MODEL,
        input
      });

      return response.data[0]?.embedding ?? [];
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string; name?: string } })?.cause;
      const detail = {
        provider: "openai",
        model: this.env.OPENAI_EMBEDDING_MODEL,
        cause: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
        causeCode: cause?.code ?? cause?.name ?? null,
        causeMessage: cause?.message ?? null
      };
      // Surface the underlying network cause so egress/DNS/TLS failures are diagnosable in prod.
      console.error("[openai-embeddings] embedText failed", JSON.stringify(detail));
      throw new AppError(503, "OpenAI embedding request failed", "embedding_provider_failed", detail);
    }
  }
}
