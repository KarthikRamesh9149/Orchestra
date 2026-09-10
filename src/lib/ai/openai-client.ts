import OpenAI, { type ClientOptions } from "openai";

/**
 * Construct an OpenAI client that uses the runtime's native `fetch` (undici on
 * Node 18+) instead of the SDK's bundled node-fetch.
 *
 * The bundled node-fetch shim hits `FetchError: ... Premature close` on some
 * container↔OpenAI network paths (observed consistently on Railway → OpenAI,
 * where native fetch to the same endpoint succeeds). Forcing native fetch makes
 * embeddings, generation, transcription, and web search reliable in production.
 */
export function createOpenAiClient(options: ClientOptions): OpenAI {
  return new OpenAI({
    ...options,
    fetch: globalThis.fetch as unknown as ClientOptions["fetch"]
  });
}
