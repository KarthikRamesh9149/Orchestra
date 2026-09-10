import type { Logger } from "pino";
import { redactAiTelemetry } from "./ai-telemetry.js";

export function logAiOpsEvent(logger: Logger, event: string, payload: unknown) {
  logger.info({ event, ai: redactAiTelemetry(payload) }, "ai_ops_event");
}
