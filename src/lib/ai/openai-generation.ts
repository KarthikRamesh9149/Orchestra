import OpenAI from "openai";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { createOpenAiClient } from "./openai-client.js";
import type { GenerationInput, GenerationProvider, TextStreamInput } from "./provider.js";

const DEFAULT_OPENAI_GENERATION_MODEL = "gpt-5.4-mini";

export class OpenAiGenerationProvider implements GenerationProvider {
  private readonly client: OpenAI;

  constructor(private readonly env: AppEnv) {
    this.client = createOpenAiClient({ apiKey: env.OPENAI_API_KEY! });
  }

  async generateObject<TSchema extends z.ZodTypeAny>(input: GenerationInput<TSchema>) {
    try {
      const abortController = new AbortController();
      const timeout = input.timeoutMs
        ? setTimeout(() => abortController.abort(), input.timeoutMs)
        : null;
      const resolvedModel = this.resolveModel(input.model);
      const response = await this.client.responses.create(
        {
          model: resolvedModel,
          instructions: this.buildSystemPrompt(input.systemPrompt),
          input: `${input.prompt}\n\nReturn the result as valid JSON.`,
          max_output_tokens: input.maxOutputTokens ?? 4000,
          ...this.reasoningParam(resolvedModel, input.task),
          text: { format: { type: "json_object" } },
          store: false
        },
        { signal: abortController.signal }
      ).finally(() => {
        if (timeout) clearTimeout(timeout);
      });

      const text = response.output_text.trim();
      return input.schema.parse(this.parseJsonObject(text));
    } catch {
      return input.schema.parse(input.fallback());
    }
  }

  async streamText(input: TextStreamInput) {
    const abortController = new AbortController();
    const abortFromCaller = () => abortController.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const armInactivityTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = input.timeoutMs
        ? setTimeout(() => abortController.abort(new Error("generation_inactivity_timeout")), input.timeoutMs)
        : null;
    };
    armInactivityTimeout();
    let answer = "";
    let incompleteReason: string | null = null;

    try {
      const resolvedModel = this.resolveModel(input.model);
      const stream = await this.client.responses.create(
        {
          model: resolvedModel,
          instructions: input.systemPrompt ?? "Answer the user directly.",
          input: input.prompt,
          max_output_tokens: input.maxOutputTokens ?? 4000,
          ...this.reasoningParam(resolvedModel, input.task),
          stream: true,
          store: false
        },
        { signal: abortController.signal }
      );

      for await (const event of stream) {
        armInactivityTimeout();
        if (abortController.signal.aborted) throw abortController.signal.reason ?? new DOMException("Aborted", "AbortError");
        if (event.type === "response.incomplete") {
          incompleteReason = event.response.incomplete_details?.reason ?? "unknown";
          continue;
        }
        if (event.type !== "response.output_text.delta") continue;
        const delta = event.delta;
        if (!delta) continue;
        answer += delta;
        await input.onDelta(delta);
      }

      if (incompleteReason) throw new Error(`openai_generation_incomplete:${incompleteReason}`);
      const normalized = answer.trim();
      if (!normalized) throw new Error("openai_generation_empty_stream");
      return normalized;
    } catch (error) {
      if (abortController.signal.aborted || input.signal?.aborted) {
        throw input.signal?.reason ?? error;
      }
      if (answer.length > 0) throw error;
      const fallback = input.fallback();
      await input.onDelta(fallback);
      return fallback;
    } finally {
      if (timeout) clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private resolveModel(model: string | undefined) {
    if (model && !model.toLowerCase().includes("claude")) {
      return model;
    }

    return this.env.SOCRATES_MODEL ?? this.env.OPENAI_GENERATION_MODEL ?? DEFAULT_OPENAI_GENERATION_MODEL;
  }

  private buildSystemPrompt(systemPrompt: string | undefined) {
    const jsonInstruction = "Return valid JSON only. Do not include markdown fences, commentary, or omitted fields.";
    if (!systemPrompt) {
      return jsonInstruction;
    }
    if (/\bjson\b/i.test(systemPrompt)) {
      return systemPrompt;
    }
    return `${systemPrompt}\n\n${jsonInstruction}`;
  }

  private reasoningParam(model: string, task?: string) {
    if (!/^(gpt-5|o[0-9])/.test(model)) return {};
    // Interactive v1 chat is already grounded and ranked before generation.
    // Minimal reasoning materially improves time-to-first-token while the
    // stricter evidence prompt and post-generation citations preserve safety.
    const interactiveV1 = task?.startsWith("socrates_v1_");
    // GPT-5.4 mini and nano reject the older `minimal` value. Use `none` for
    // the latency-sensitive v1 path; the evidence ranking and system policy
    // already provide the required grounding constraints.
    const effort = interactiveV1 && /^gpt-5\.4-(?:mini|nano)/i.test(model)
      ? "none"
      : "low";
    return {
      reasoning: {
        // The pinned SDK's ReasoningEffort union may lag runtime model values.
        effort: effort as "low"
      }
    };
  }

  private parseJsonObject(text: string) {
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1));
      }
      throw new Error("openai_generation_invalid_json");
    }
  }
}
