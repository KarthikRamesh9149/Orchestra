import OpenAI from "openai";
import type { AppEnv } from "../../config/env.js";
import { createOpenAiClient } from "./openai-client.js";
import type { TranscriptionProvider } from "./provider.js";

export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  private readonly client: OpenAI;

  constructor(private readonly env: AppEnv) {
    this.client = createOpenAiClient({ apiKey: env.OPENAI_API_KEY });
  }

  async transcribeAudio(input: { fileName: string; contentType: string; buffer: Buffer }) {
    const file = new File([input.buffer], input.fileName, { type: input.contentType });
    const response = await this.client.audio.transcriptions.create({
      file,
      model: this.env.OPENAI_TRANSCRIPTION_MODEL
    });

    return {
      text: response.text.trim(),
      provider: "openai"
    };
  }
}
