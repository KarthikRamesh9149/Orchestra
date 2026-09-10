import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpAgentSetup } from "./McpAgentSetup";

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn()
}));

vi.mock("../../lib/api/mcp", () => ({
  getMcpReadiness: mocks.readiness,
  listMcpTokens: mocks.list,
  createMcpToken: mocks.create,
  revokeMcpToken: mocks.revoke
}));

const readiness = {
  enabled: true,
  mode: "team_internal",
  readOnlyDefault: true,
  controlledWritesEnabled: true,
  transport: "streamable_http_json_response",
  protocolVersions: ["2025-11-25"],
  endpoint: "/v1/mcp",
  tokenStorage: "hashed_at_rest",
  limitations: []
};

describe("McpAgentSetup", () => {
  beforeEach(() => {
    mocks.readiness.mockReset().mockResolvedValue(readiness);
    mocks.list.mockReset().mockResolvedValue([]);
    mocks.create.mockReset().mockResolvedValue({
      token: "mcp_one-time-secret",
      tokenSecretShownOnce: true,
      tokenRecord: { id: "token-1", label: "Cursor", tokenPrefix: "mcp_one-time", mode: "team_internal", status: "active", projectIds: ["project-1"], allowedTools: ["orchestra.get_context_pack", "orchestra.record_agent_run"], readOnly: false, allowControlledWrites: true, expiresAt: null, lastUsedAt: null, revokedAt: null, createdAt: new Date().toISOString() }
    });
    mocks.revoke.mockReset();
  });

  it("provides a project-scoped Cursor configuration using an environment variable", async () => {
    render(<McpAgentSetup projectId="project-1" packId="pack-1" targetAgent="cursor" toast={vi.fn()} />);
    expect(await screen.findByText("Connect Cursor to this Preflight")).toBeVisible();
    expect(screen.getByText(/Bearer \$\{env:ORCHESTRA_MCP_TOKEN\}/)).toBeVisible();
    expect(screen.getByText(/pack-1/)).toBeVisible();
  });

  it("shows a token exactly once and requests only the selected project's Preflight and Postflight tools", async () => {
    const user = userEvent.setup();
    render(<McpAgentSetup projectId="project-1" packId="pack-1" targetAgent="codex" toast={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Create Codex token" }));
    expect(await screen.findByText("mcp_one-time-secret")).toBeVisible();
    expect(mocks.create).toHaveBeenCalledWith({ label: expect.stringContaining("Codex"), projectId: "project-1", includePostflight: true });
    await waitFor(() => expect(screen.getByText(/Preflight \+ Postflight/)).toBeVisible());
  });
});
