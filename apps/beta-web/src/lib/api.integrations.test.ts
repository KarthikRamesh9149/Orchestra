import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server";
import {
  clearAuth,
  connectIntegration,
  disconnectIntegration,
  getIntegrationsList,
  syncIntegration,
} from "./api";

const api = "http://localhost:3000";
const projectId = "11111111-1111-4111-8111-111111111111";

describe("[FIX-19] integration capability contracts", () => {
  beforeEach(() => clearAuth());

  it('offers reconnect for an explicitly reconnectable revoked grant, never sync',async()=>{
    server.use(
      http.get(`${api}/v1/projects/${projectId}/integrations/status`,()=>HttpResponse.json({data:{providers:[{provider:'slack',connected:false,availableActions:['connect']}]}})),
      http.get(`${api}/v1/projects/${projectId}/connectors/readiness`,()=>HttpResponse.json({data:[{provider:'slack',connectorId:'revoked-id',connectorStatus:'revoked',readiness:{state:'revoked',canConnect:true,canSync:false,canDisconnect:false,reasons:['connector_revoked'],missingConfig:[],deferredFeatures:[]}}]}))
    );
    const [slack]=await getIntegrationsList(projectId);
    expect(slack.capabilities).toEqual({canConnect:true,canSync:false,canDisconnect:false});
  });

  it("preserves action capabilities and readiness while excluding manual imports", async () => {
    server.use(
      http.get(`${api}/v1/projects/${projectId}/integrations/status`, () => HttpResponse.json({
        data: {
          providers: [
            { provider: "slack", label: "Slack", connected: false, status: "not_configured", availableActions: [], limitations: ["missing_oauth_configuration"] },
            { provider: "google_drive", label: "Google Drive", connected: true, status: "connected", availableActions: ["sync", "disconnect"] },
            { provider: "fireflies_ai", label: "Fireflies.ai", connected: false, status: "connectable", availableActions: ["connect", "manual_import"] },
          ],
        },
        meta: null,
        error: null,
      })),
      http.get(`${api}/v1/projects/${projectId}/connectors/readiness`, () => HttpResponse.json({
        data: [
          {
            provider: "slack",
            metadata: { label: "Slack", description: "Slack evidence" },
            connectorId: null,
            connectorStatus: null,
            readiness: { state: "readiness_gated", canConnect: false, canSync: false, canDisconnect: false, canWebhook: false, reasons: ["missing_oauth_configuration"], missingConfig: ["SLACK_CLIENT_SECRET"], deferredFeatures: [] },
          },
          {
            provider: "fireflies_ai",
            metadata: { label: "Fireflies.ai", description: "Meeting evidence" },
            connectorId: null,
            connectorStatus: null,
            readiness: { state: "readiness_gated", canConnect: true, canSync: false, canDisconnect: false, canWebhook: false, reasons: ["manual_import_available_live_api_gated"], missingConfig: [], deferredFeatures: ["fireflies_live_sync_disabled_in_manual_only_mode"] },
          },
          {
            provider: "manual_import",
            metadata: { label: "Manual import" },
            connectorId: null,
            connectorStatus: null,
            readiness: { state: "enabled", canConnect: true, canSync: false, canDisconnect: false, canWebhook: false, reasons: [], missingConfig: [], deferredFeatures: [] },
          },
          {
            provider: "notion",
            metadata: { label: "Notion", description: "Notion evidence" },
            connectorId: "connector-notion",
            connectorStatus: "syncing",
            readiness: { state: "enabled", canConnect: true, canSync: true, canDisconnect: true, canWebhook: false, reasons: [], missingConfig: [], deferredFeatures: [] },
          },
        ],
        meta: null,
        error: null,
      }))
    );

    const result = await getIntegrationsList(projectId);

    expect(result.map((item) => item.id)).toEqual(["slack", "google_drive", "fireflies_ai", "notion"]);
    expect(result[0]).toMatchObject({
      status: "unavailable",
      capabilities: { canConnect: false, canSync: false, canDisconnect: false },
      readiness: { state: "readiness_gated", reasons: ["missing_oauth_configuration"] },
      disclaimer: "Slack is not configured by an administrator.",
    });
    expect(result[1]).toMatchObject({
      status: "connected",
      capabilities: { canConnect: false, canSync: true, canDisconnect: true },
    });
    expect(result[2]).toMatchObject({
      status: "unavailable",
      capabilities: { canConnect: false, canSync: false, canDisconnect: false },
      readiness: { state: "readiness_gated" },
    });
    expect(result[3]).toMatchObject({
      status: "connected",
      connectorId: "connector-notion",
      capabilities: { canConnect: false, canSync: true, canDisconnect: true },
    });
  });

  it("routes connect, sync, and disconnect to the provider's authoritative endpoint", async () => {
    const calls: string[] = [];
    server.use(
      http.post(`${api}/v1/projects/${projectId}/connectors/gmail/connect`, async ({ request }) => {
        calls.push(`gmail-connect:${JSON.stringify(await request.json())}`);
        return HttpResponse.json({ data: { redirectUrl: "https://accounts.google.com/o/oauth2/v2/auth" }, meta: null, error: null });
      }),
      http.get(`${api}/v1/github/install-url`, () => {
        calls.push("github-connect");
        return HttpResponse.json({ data: { installUrl: "https://github.com/apps/orchestra/installations/new" }, meta: null, error: null });
      }),
      http.post(`${api}/v1/projects/${projectId}/connectors/google-calendar/sync`, () => {
        calls.push("calendar-sync");
        return HttpResponse.json({ data: { status: "queued" }, meta: null, error: null });
      }),
      http.post(`${api}/v1/projects/${projectId}/connectors/connector-1/sync`, () => {
        calls.push("slack-sync");
        return HttpResponse.json({ data: { status: "queued" }, meta: null, error: null });
      }),
      http.post(`${api}/v1/projects/${projectId}/github/backfill`, async ({ request }) => {
        calls.push(`github-sync:${JSON.stringify(await request.json())}`);
        return HttpResponse.json({ data: { status: "completed" }, meta: null, error: null });
      }),
      http.post(`${api}/v1/projects/${projectId}/connectors/connector-1/revoke`, () => {
        calls.push("slack-disconnect");
        return HttpResponse.json({ data: { status: "revoked" }, meta: null, error: null });
      })
    );

    await expect(connectIntegration(projectId, "github")).resolves.toMatchObject({ authorizationUrl: expect.stringContaining("github.com/apps") });
    await expect(connectIntegration(projectId, "gmail")).resolves.toMatchObject({ redirectUrl: expect.stringContaining("accounts.google.com") });
    await syncIntegration(projectId, "google_calendar");
    await syncIntegration(projectId, "slack", "connector-1");
    await syncIntegration(projectId, "github");
    await disconnectIntegration(projectId, "slack", "connector-1");

    expect(calls).toEqual([
      "github-connect",
      'gmail-connect:{"returnTo":"/settings#integrations","purpose":"invitation_sender"}',
      "calendar-sync",
      "slack-sync",
      'github-sync:{"dryRun":false,"mode":"incremental"}',
      "slack-disconnect",
    ]);
  });
});
