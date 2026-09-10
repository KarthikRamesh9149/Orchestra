import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiEmbeddingProvider } from "../src/lib/ai/openai-embeddings.js";

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    embeddings = {
      create: createMock
    };
  }
}));

describe("OpenAiEmbeddingProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns provider embeddings when OpenAI succeeds", async () => {
    createMock.mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    const provider = new OpenAiEmbeddingProvider({
      OPENAI_API_KEY: "test-key",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small"
    } as any);

    await expect(provider.embedText("project memory")).resolves.toEqual([0.1, 0.2, 0.3]);
  });

  it("throws a typed degradation error instead of returning synthetic vectors when OpenAI fails", async () => {
    createMock.mockRejectedValueOnce(new Error("network down"));
    const provider = new OpenAiEmbeddingProvider({
      OPENAI_API_KEY: "test-key",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small"
    } as any);

    await expect(provider.embedText("project memory")).rejects.toMatchObject({
      code: "embedding_provider_failed",
      statusCode: 503
    });
  });
});
