import type { AgentContextCitation, AgentContextOpenTarget } from "./types.js";

const unsafeValuePattern =
  /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|FIREFLIES_API_KEY|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|CLIENT_SHARE_TOKEN_SECRET|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|DATABASE_URL|PRIVATE_KEY)\s*=\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|xox[abprs]-[A-Za-z0-9-]{12,}|gh[opsur]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|mcp_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|postgresql:\/\/\S+:\S+@\S+|OPENAI_API_KEY|ANTHROPIC_API_KEY|FIREFLIES_API_KEY|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|CLIENT_SHARE_TOKEN_SECRET|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|DATABASE_URL|PRIVATE_KEY|https?:\/\/(?:app\.fireflies\.ai|download\.fireflies\.ai|localhost|127\.0\.0\.1|10\.|172\.(?:1[6-9]|2\d|3[0-1])\.|192\.168\.))/gi;

const allowedOpenTargetTypes = new Set([
  "document_section",
  "document_chunk",
  "live_doc_section",
  "brain_node",
  "product_brain",
  "change_proposal",
  "decision_record",
  "project_context",
  "project_diagram",
  "coding_requirements",
  "project_responsibility",
  "dashboard_snapshot",
  "communication_message",
  "communication_thread",
  "agent_run"
]);

function containsUnsafeAgentContextValue(value: string) {
  unsafeValuePattern.lastIndex = 0;
  return unsafeValuePattern.test(value);
}

export function validateAgentContextCitation(citation?: AgentContextCitation | null) {
  if (!citation?.type || !citation.id) return { valid: false, reason: "missing_citation" };
  if (containsUnsafeAgentContextValue(JSON.stringify(citation))) return { valid: false, reason: "unsafe_citation" };
  return { valid: true as const };
}

export function validateAgentContextOpenTarget(openTarget?: AgentContextOpenTarget | null) {
  if (!openTarget?.targetType || !openTarget.targetRef) {
    return { valid: false, reason: "missing_open_target" };
  }
  if (!allowedOpenTargetTypes.has(openTarget.targetType)) {
    return { valid: false, reason: "unsupported_open_target" };
  }
  if (containsUnsafeAgentContextValue(JSON.stringify(openTarget))) {
    return { valid: false, reason: "unsafe_open_target" };
  }
  return { valid: true as const };
}

export function redactAgentContextText(text: string) {
  unsafeValuePattern.lastIndex = 0;
  return text.replace(unsafeValuePattern, "[redacted]");
}
