import { apiJson } from "./client";

export type McpReadiness = {
  enabled: boolean;
  mode: "local_dev" | "team_internal" | "client_safe_future";
  readOnlyDefault: true;
  controlledWritesEnabled: boolean;
  transport: string;
  protocolVersions: string[];
  endpoint: string;
  tokenStorage: "hashed_at_rest";
  limitations: string[];
};

export type McpToken = {
  id: string;
  label: string;
  tokenPrefix: string;
  mode: string;
  status: string;
  projectIds: string[];
  allowedTools: string[];
  readOnly: boolean;
  allowControlledWrites: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export const getMcpReadiness = () => apiJson<McpReadiness>("/v1/mcp/readiness");
export const listMcpTokens = () => apiJson<McpToken[]>("/v1/mcp/tokens");
export const createMcpToken = (input: { label: string; projectId: string; includePostflight: boolean }) => apiJson<{ token: string; tokenSecretShownOnce: true; tokenRecord: McpToken }>("/v1/mcp/tokens", {
  method: "POST",
  body: JSON.stringify({
    label: input.label,
    mode: "team_internal",
    projectIds: [input.projectId],
    allowedTools: ["orchestra.get_context_pack", ...(input.includePostflight ? ["orchestra.record_agent_run"] : [])],
    allowControlledWrites: input.includePostflight
  })
});
export const revokeMcpToken = (tokenId: string) => apiJson<McpToken>(`/v1/mcp/tokens/${encodeURIComponent(tokenId)}/revoke`, { method: "POST", body: "{}" });
