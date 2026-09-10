import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { AuthEmailService } from "../src/modules/auth/auth-email.service.js";

const env = {
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "test-connector-key-with-enough-length",
  CONNECTOR_CREDENTIAL_VAULT_MODE: "memory",
  DEPLOYMENT_ENV: "test",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_ROOT: "/tmp/orchestra-auth-email-test"
} as any;

function setup(credential: Record<string, unknown> | null, fetchImpl = vi.fn()) {
  const prisma = {
    communicationConnector: {
      findFirst: vi.fn(async () => ({
        id: "connector-1",
        projectId: "project-1",
        credentialsRef: "vault:gmail:connector-1",
        accountLabel: "owner@example.com"
      }))
    }
  } as any;
  const vault = {
    getCredential: vi.fn(async () => credential),
    putCredential: vi.fn(async () => ({ ref: "vault:gmail:connector-1" }))
  };
  return { service: new AuthEmailService(prisma, env, fetchImpl as any, vault), prisma, vault, fetchImpl };
}

describe("AuthEmailService", () => {
  it("fails closed when the connected Gmail account lacks send scope", async () => {
    const { service, fetchImpl } = setup({ accessToken: "secret-token", scope: "https://www.googleapis.com/auth/gmail.readonly" });
    const result = await service.sendWorkspaceInvite({
      projectId: "project-1",
      to: "invitee@example.com",
      projectName: "Example",
      activationCode: "ABC234",
      inviteUrl: "https://beta.orchestraos.dev/login?invite_token=secret",
      expiresAt: new Date("2026-09-01T00:00:00.000Z")
    });
    expect(result).toMatchObject({ status: "manual_required", errorCode: "gmail_send_scope_missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a one-time activation link through Gmail without exposing OAuth credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "gmail-message-1" }), { status: 200, headers: { "content-type": "application/json" } }));
    const { service } = setup({
      accessToken: "oauth-access-secret",
      emailAddress: "owner@example.com",
      expiryDate: Date.now() + 300_000,
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send"
    }, fetchImpl);
    const result = await service.sendWorkspaceInvite({
      projectId: "project-1",
      to: "invitee@example.com\r\nBcc: attacker@example.com",
      projectName: "Example",
      activationCode: "ABC234",
      inviteUrl: "https://beta.orchestraos.dev/login?invite_token=one-time-link",
      expiresAt: new Date("2026-09-01T00:00:00.000Z")
    });
    expect(result).toMatchObject({ status: "sent", provider: "gmail", from: "owner@example.com", messageId: "gmail-message-1" });
    const [, request] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((request.headers as Record<string, string>).authorization).toBe("Bearer oauth-access-secret");
    const raw = JSON.parse(request.body as string).raw as string;
    const message = Buffer.from(raw, "base64url").toString("utf8");
    expect(message).toContain("Activation code: ABC234");
    expect(message).toContain("invite_token=one-time-link");
    expect(message).not.toContain("\r\nBcc: attacker@example.com\r\n");
    expect(message).not.toContain("oauth-access-secret");
  });

  it("reports Gmail API failures honestly", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "denied" }), { status: 403 }));
    const { service } = setup({ accessToken: "secret", scope: "https://www.googleapis.com/auth/gmail.send" }, fetchImpl);
    const result = await service.sendEmailVerification({
      projectId: "project-1",
      to: "user@example.com",
      displayName: "User",
      verificationUrl: "https://beta.orchestraos.dev/login?verify_email=one-time",
      expiresAt: new Date("2026-09-01T00:00:00.000Z")
    });
    expect(result).toMatchObject({ status: "failed", provider: "gmail", errorCode: "gmail_send_http_403" });
  });
});
