import { Buffer } from "node:buffer";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { CredentialVault } from "../../lib/communications/credential-vault.js";

type GmailCredential = {
  accessToken?: string;
  refreshToken?: string;
  expiryDate?: number;
  emailAddress?: string;
  scope?: string;
};

export type AuthEmailDelivery = {
  status: "sent" | "manual_required" | "failed";
  provider: "gmail" | null;
  from: string | null;
  sentAt: Date | null;
  messageId: string | null;
  errorCode: string | null;
};

type AuthEmailCredentialVault = Pick<CredentialVault, "getCredential" | "putCredential">;

export class AuthEmailService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly vault: AuthEmailCredentialVault = new CredentialVault(env)
  ) {}

  async sendWorkspaceInvite(input: { projectId: string; to: string; projectName: string; activationCode: string; inviteUrl: string; expiresAt: Date }): Promise<AuthEmailDelivery> {
    return this.sendFromProject({
      projectId: input.projectId,
      to: input.to,
      subject: `You're invited to ${input.projectName} on OrchestraOS`,
      text: [
        `You've been invited to join ${input.projectName} on OrchestraOS.`,
        "",
        `Activation code: ${input.activationCode}`,
        `Activate securely: ${input.inviteUrl}`,
        `This invitation expires ${input.expiresAt.toISOString()} and can only be used once by this email address.`,
        "",
        "If you were not expecting this invitation, you can ignore this email."
      ].join("\n")
    });
  }

  async sendEmailVerification(input: { projectId: string; to: string; displayName: string; verificationUrl: string; expiresAt: Date }): Promise<AuthEmailDelivery> {
    return this.sendFromProject({
      projectId: input.projectId,
      to: input.to,
      subject: "Verify your OrchestraOS email",
      text: [
        `Hi ${input.displayName},`,
        "",
        "Verify your OrchestraOS email by opening this one-time link:",
        input.verificationUrl,
        `The link expires ${input.expiresAt.toISOString()}.`,
        "",
        "If you did not request this, ignore this email."
      ].join("\n")
    });
  }

  private async sendFromProject(input: { projectId: string; to: string; subject: string; text: string }): Promise<AuthEmailDelivery> {
    const connector = await this.prisma.communicationConnector.findFirst({
      where: { projectId: input.projectId, provider: "gmail", status: { in: ["connected", "syncing"] } },
      orderBy: { updatedAt: "desc" }
    });
    if (!connector?.credentialsRef) return unavailable("gmail_connector_not_connected");

    const stored = await this.vault.getCredential("gmail", connector.id, connector.credentialsRef) as GmailCredential | null;
    if (!stored?.accessToken) return unavailable("gmail_credential_missing");
    if (!scopes(stored.scope).has("https://www.googleapis.com/auth/gmail.send")) return unavailable("gmail_send_scope_missing");

    const credential = await this.refreshIfNeeded(stored);
    if (!credential.accessToken) return unavailable("gmail_credential_missing");
    if (credential !== stored) {
      await this.vault.putCredential({ provider: "gmail", connectorId: connector.id, credential: credential as Record<string, unknown> });
    }

    const from = credential.emailAddress ?? connector.accountLabel;
    const raw = Buffer.from([
      `From: OrchestraOS <${headerValue(from)}>`,
      `To: ${headerValue(input.to)}`,
      `Subject: ${headerValue(input.subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.text
    ].join("\r\n"), "utf8").toString("base64url");

    try {
      const response = await this.fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { authorization: `Bearer ${credential.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(5_000)
      });
      const payload = await response.json().catch(() => null) as { id?: unknown } | null;
      if (!response.ok || typeof payload?.id !== "string") return { ...unavailable(`gmail_send_http_${response.status}`), status: "failed", provider: "gmail", from };
      return { status: "sent", provider: "gmail", from, sentAt: new Date(), messageId: payload.id, errorCode: null };
    } catch {
      return { ...unavailable("gmail_send_network_error"), status: "failed", provider: "gmail", from };
    }
  }

  private async refreshIfNeeded(credential: GmailCredential): Promise<GmailCredential> {
    if (!credential.expiryDate || credential.expiryDate > Date.now() + 60_000) return credential;
    if (!credential.refreshToken || !this.env.GOOGLE_CLIENT_ID || !this.env.GOOGLE_CLIENT_SECRET) return credential;
    try {
      const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET, refresh_token: credential.refreshToken, grant_type: "refresh_token" }),
        signal: AbortSignal.timeout(5_000)
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok || typeof payload.access_token !== "string") return credential;
      return { ...credential, accessToken: payload.access_token, expiryDate: Date.now() + Number(payload.expires_in ?? 3600) * 1000, scope: typeof payload.scope === "string" ? payload.scope : credential.scope };
    } catch {
      return credential;
    }
  }
}

function scopes(value: string | undefined) { return new Set((value ?? "").split(/\s+/).filter(Boolean)); }
function headerValue(value: string) { return value.replace(/[\r\n]+/g, " ").trim(); }
function unavailable(errorCode: string): AuthEmailDelivery { return { status: "manual_required", provider: null, from: null, sentAt: null, messageId: null, errorCode }; }
