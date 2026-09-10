import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  advertisedProviderKeys,
  isProviderReleaseValidated,
  PROVIDER_RELEASE_VALIDATION_REASON
} from "../src/lib/integrations/provider-release.js";
import { getProviderReadiness } from "../src/modules/communications/provider-readiness.js";
import { IntegrationManagementService } from "../src/modules/integrations/integrations.service.js";
import type { AppEnv } from "../src/config/env.js";

type Dimension = "connect" | "scopeSelection" | "sync" | "retry" | "evidence" | "citations" | "revoke" | "secretRedaction";
type Matrix = {
  dimensions: Dimension[];
  providers: Array<{
    id: string;
    providerKeys: string[];
    contractStatus: string;
    liveStatus: string;
    productionActionable: boolean;
    evidence: Record<Dimension, string[]>;
  }>;
};

const root = path.resolve(import.meta.dirname, "..");
const matrix = JSON.parse(
  await readFile(path.join(root, "docs/remediation/provider-validation-matrix.json"), "utf8")
) as Matrix;
const productionBetaEnv = { NODE_ENV: "production", ORCHESTRA_PROFILE: "mvp_beta", MVP_BETA_MODE: true } as AppEnv;
const dimensionSignals: Record<Dimension, RegExp> = {
  connect: /connect|pair|install/i,
  scopeSelection: /select|scope|project/i,
  sync: /sync|activity|backfill/i,
  retry: /retry|re-pair|expired|stale|rate.?limit|attempt/i,
  evidence: /evidence|message|document|timeline/i,
  citations: /citation/i,
  revoke: /revoke|disconnect|archive/i,
  secretRedaction: /redact|token.?hash|credential|secret/i
};
const providerSignals: Record<string, RegExp> = {
  slack: /slack/i, teams: /teams|microsoft/i, notion: /notion/i, drive: /drive/i,
  calendar: /calendar/i, github: /github/i, fireflies: /fireflies/i, clickup: /clickup/i,
  granola: /granola/i, zoho: /zoho/i, vscode: /vs.?code|vscode/i
};

describe("[FIX-31] advertised provider release validation", () => {
  it("covers every advertised provider and every required validation dimension with real evidence files", async () => {
    expect(matrix.dimensions).toEqual(["connect", "scopeSelection", "sync", "retry", "evidence", "citations", "revoke", "secretRedaction"]);
    expect(matrix.providers.flatMap((provider) => provider.providerKeys).sort()).toEqual([...advertisedProviderKeys].sort());

    for (const provider of matrix.providers) {
      expect(provider.contractStatus).toBe("passed");
      const providerEvidence = new Set<string>();
      for (const dimension of matrix.dimensions) {
        expect(provider.evidence[dimension]?.length, `${provider.id}.${dimension}`).toBeGreaterThan(0);
        const dimensionContents: string[] = [];
        for (const evidencePath of provider.evidence[dimension]) {
          await expect(access(path.join(root, evidencePath))).resolves.toBeUndefined();
          providerEvidence.add(evidencePath);
          dimensionContents.push(await readFile(path.join(root, evidencePath), "utf8"));
        }
        expect(dimensionContents.join("\n"), `${provider.id}.${dimension} behavioral signal`).toMatch(dimensionSignals[dimension]);
      }
      const allEvidence = (await Promise.all([...providerEvidence].map((item) => readFile(path.join(root, item), "utf8")))).join("\n");
      expect(allEvidence, `${provider.id} identity signal`).toMatch(providerSignals[provider.id]);
    }
  });

  it("keeps every external provider non-actionable without credential-backed live proof", () => {
    for (const provider of matrix.providers) {
      const expectedActionable = provider.providerKeys.every((key) => isProviderReleaseValidated(productionBetaEnv, key));
      expect(provider.productionActionable, provider.id).toBe(expectedActionable);
      if (provider.id !== "vscode") {
        expect(provider.liveStatus, provider.id).toBe("blocked_missing_credentials");
        expect(provider.productionActionable, provider.id).toBe(false);
      }
    }
  });

  it("fails communication providers closed in production beta even when credentials are configured", () => {
    const readiness = getProviderReadiness({
      ...productionBetaEnv,
      SLACK_CLIENT_ID: "configured",
      SLACK_CLIENT_SECRET: "configured",
      SLACK_REDIRECT_URI: "https://api.example.test/slack/callback",
      SLACK_SIGNING_SECRET: "configured"
    }, "slack");

    expect(readiness).toMatchObject({
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      canWebhook: false,
      reasons: [PROVIDER_RELEASE_VALIDATION_REASON]
    });
  });

  it("enables only providers explicitly certified by the production operator", () => {
    const readiness = getProviderReadiness({
      ...productionBetaEnv,
      PROVIDER_RELEASE_VALIDATED_PROVIDERS: ["slack", "vscode"],
      SLACK_CLIENT_ID: "configured",
      SLACK_CLIENT_SECRET: "configured",
      SLACK_REDIRECT_URI: "https://api.example.test/slack/callback",
      SLACK_SIGNING_SECRET: "configured"
    }, "slack");

    expect(readiness).toMatchObject({
      state: "enabled",
      canConnect: true,
      canSync: true
    });
    expect(isProviderReleaseValidated({
      ...productionBetaEnv,
      PROVIDER_RELEASE_VALIDATED_PROVIDERS: ["slack", "vscode"]
    }, "microsoft_teams")).toBe(false);
  });

  it("keeps Fireflies manual-only readiness distinct from a validated live connection", () => {
    const readiness = getProviderReadiness({
      ...productionBetaEnv,
      NODE_ENV: "test",
      FIREFLIES_READINESS_MODE: "manual_only"
    }, "fireflies_ai");
    expect(readiness).toMatchObject({ state: "readiness_gated", canConnect: true, canSync: false, canManualImport: true });
  });

  it("publishes no external connect or sync action in production beta before live validation", async () => {
    const service = new IntegrationManagementService(
      {
        communicationConnector: { findFirst: async () => null },
        projectEditorConnector: { findMany: async () => [] }
      } as never,
      productionBetaEnv,
      { ensureProjectAccess: async () => ({ id: "membership" }) } as never,
      {
        getGoogleCalendarStatus: async () => ({
          enabled: true, configured: true, connected: false, selectedCalendarIds: [], lastSyncedAt: null,
          error: null, connection: null, webhookState: { status: "disabled", reason: null }
        })
      } as never,
      {
        getStatus: async () => ({
          enabled: true, configured: true, connected: false, state: "not_connected", connection: null,
          latestSyncRun: null, indexedFileCount: 0, limitations: []
        })
      } as never,
      {
        getProjectIntegration: async () => ({
          linkedRepositories: [], latestSyncRuns: [], readiness: { enabled: true, configured: true }
        })
      } as never
    );

    const result = await service.getProjectIntegrationStatus("project-1", { userId: "user-1", orgId: "org-1" });
    const vscode = result.providers.find((provider) => provider.provider === "vscode");
    expect(vscode?.availableActions).toEqual(["connect"]);
    for (const provider of result.providers.filter((item) => item.provider !== "vscode")) {
      expect(provider.availableActions, provider.provider).not.toContain("connect");
      expect(provider.availableActions, provider.provider).not.toContain("sync");
    }
  });
});
