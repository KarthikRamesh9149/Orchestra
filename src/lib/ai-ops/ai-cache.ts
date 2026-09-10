import type { AiCacheTelemetry } from "./ai-ops-schemas.js";

export function cacheTelemetry(input: Partial<AiCacheTelemetry> & { hit: boolean; namespace: string }): AiCacheTelemetry {
  return {
    hit: input.hit,
    namespace: input.namespace,
    safetyClass: input.safetyClass ?? "suggestion_safe",
    keyClass: input.keyClass
  };
}
