import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
  create: vi.fn()
}));

vi.mock("openai", () => ({
  default: vi.fn(function MockOpenAI(this: any) {
    this.responses = {
      create: openAiMocks.create
    };
  })
}));

import { createGenerationProvider } from "../src/lib/ai/index.js";
import { OpenAiGenerationProvider } from "../src/lib/ai/openai-generation.js";

describe("OpenAI generation provider", () => {
  beforeEach(() => {
    openAiMocks.create.mockReset();
  });

  it("uses OpenAI for generation", () => {
    const provider = createGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);

    expect(provider).toBeInstanceOf(OpenAiGenerationProvider);
  });

  it("requests JSON output from the configured cheap OpenAI model", async () => {
    openAiMocks.create.mockResolvedValueOnce({
      output_text: JSON.stringify({ answer: "from openai" })
    });
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);

    const result = await provider.generateObject({
      prompt: "Return an answer as JSON.",
      systemPrompt: "Return valid JSON only.",
      schema: z.object({ answer: z.string() }),
      model: "gpt-5.4-mini",
      maxOutputTokens: 120,
      fallback: () => ({ answer: "fallback" })
    });

    expect(result).toEqual({ answer: "from openai" });
    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4-mini",
        max_output_tokens: 120,
        reasoning: { effort: "low" },
        text: { format: { type: "json_object" } },
        instructions: "Return valid JSON only.",
        input: "Return an answer as JSON.\n\nReturn the result as valid JSON.",
        store: false
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("uses Responses max_output_tokens for legacy generation models", async () => {
    openAiMocks.create.mockResolvedValueOnce({
      output_text: JSON.stringify({ answer: "from legacy model" })
    });
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);

    await provider.generateObject({
      prompt: "Return JSON.",
      schema: z.object({ answer: z.string() }),
      model: "gpt-4.1-mini",
      maxOutputTokens: 90,
      fallback: () => ({ answer: "fallback" })
    });

    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4.1-mini",
        max_output_tokens: 90
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(openAiMocks.create.mock.calls[0]?.[0].reasoning).toBeUndefined();
  });

  it("falls back when OpenAI returns malformed JSON", async () => {
    openAiMocks.create.mockResolvedValueOnce({
      output_text: "not json"
    });
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);

    await expect(
      provider.generateObject({
        prompt: "Return JSON.",
        schema: z.object({ answer: z.string() }),
        fallback: () => ({ answer: "fallback" })
      })
    ).resolves.toEqual({ answer: "fallback" });
  });

  it("accepts a valid JSON object wrapped by incidental text", async () => {
    openAiMocks.create.mockResolvedValueOnce({
      output_text: "Here is the JSON:\n{\"answer\":\"from extracted object\"}"
    });
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);

    await expect(
      provider.generateObject({
        prompt: "Return JSON.",
        schema: z.object({ answer: z.string() }),
        fallback: () => ({ answer: "fallback" })
      })
    ).resolves.toEqual({ answer: "from extracted object" });
  });

  it("keeps the required JSON instruction when callers provide a custom system prompt", async () => {
    openAiMocks.create.mockResolvedValueOnce({
      output_text: JSON.stringify({ answer: "from custom prompt" })
    });
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);

    await provider.generateObject({
      prompt: "Question and evidence.",
      systemPrompt: "Answer only from uploaded document evidence.",
      schema: z.object({ answer: z.string() }),
      fallback: () => ({ answer: "fallback" })
    });

    const request = openAiMocks.create.mock.calls[0]?.[0];
    expect(request.instructions).toContain("Answer only from uploaded document evidence.");
    expect(request.instructions).toMatch(/JSON/i);
    expect(request.input).toMatch(/JSON/i);
  });

  it("streams Responses API text deltas in order", async () => {
    async function* stream() {
      yield { type: "response.created" };
      yield { type: "response.output_text.delta", delta: "Grounded " };
      yield { type: "response.output_text.delta", delta: "answer" };
      yield { type: "response.completed" };
    }
    openAiMocks.create.mockResolvedValueOnce(stream());
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);
    const deltas: string[] = [];

    const result = await provider.streamText!({
      prompt: "Question and evidence.",
      systemPrompt: "Answer only from evidence.",
      model: "gpt-5.4-mini",
      maxOutputTokens: 120,
      task: "socrates_v1_answer",
      fallback: () => "fallback",
      onDelta: async (delta) => { deltas.push(delta); }
    });

    expect(result).toBe("Grounded answer");
    expect(deltas).toEqual(["Grounded ", "answer"]);
    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4-mini",
        input: "Question and evidence.",
        instructions: "Answer only from evidence.",
        max_output_tokens: 120,
        reasoning: { effort: "none" },
        stream: true,
        store: false
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("uses the timeout as an inactivity watchdog so a progressing answer can finish", async () => {
    async function* stream() {
      yield { type: "response.output_text.delta", delta: "Complete " };
      await new Promise((resolve) => setTimeout(resolve, 30));
      yield { type: "response.output_text.delta", delta: "grounded " };
      await new Promise((resolve) => setTimeout(resolve, 30));
      yield { type: "response.output_text.delta", delta: "answer." };
    }
    openAiMocks.create.mockResolvedValueOnce(stream());
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);

    await expect(provider.streamText!({
      prompt: "Synthesize the ranked evidence.",
      model: "gpt-5.4-mini",
      maxOutputTokens: 600,
      timeoutMs: 45,
      task: "socrates_v1_answer",
      fallback: () => "fallback",
      onDelta: async () => undefined
    })).resolves.toBe("Complete grounded answer.");
  });

  it("rejects a token-limited partial stream instead of marking it complete", async () => {
    async function* stream() {
      yield { type: "response.output_text.delta", delta: "This answer ends mid-" };
      yield {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } }
      };
    }
    openAiMocks.create.mockResolvedValueOnce(stream());
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-nano"
    } as any);

    await expect(provider.streamText!({
      prompt: "Summarize GitHub.",
      model: "gpt-5.4-nano",
      maxOutputTokens: 640,
      task: "socrates_v1_answer",
      fallback: () => "Complete evidence fallback.",
      onDelta: async () => undefined
    })).rejects.toThrow("openai_generation_incomplete:max_output_tokens");
  });

  it("uses supported no-reasoning mode for low-latency v1 mini and nano synthesis", async () => {
    async function* stream() {
      yield { type: "response.output_text.delta", delta: "Fast grounded answer" };
    }
    openAiMocks.create.mockResolvedValueOnce(stream());
    const provider = new OpenAiGenerationProvider({
      OPENAI_API_KEY: "sk-test-openai-key",
      SOCRATES_MODEL: "gpt-5.4-mini"
    } as any);

    await provider.streamText!({
      prompt: "Question and ranked evidence.",
      model: "gpt-5.4-nano",
      maxOutputTokens: 350,
      task: "socrates_v1_answer",
      fallback: () => "fallback",
      onDelta: async () => undefined
    });

    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4-nano",
        reasoning: { effort: "none" }
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
