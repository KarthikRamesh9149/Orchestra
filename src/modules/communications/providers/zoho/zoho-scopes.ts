import type { CommunicationProvider } from "@prisma/client";
import type { AppEnv } from "../../../../config/env.js";

export const ZOHO_MAIL_READ_SCOPES = ["ZohoMail.accounts.READ", "ZohoMail.folders.READ", "ZohoMail.messages.READ"] as const;
export const ZOHO_CLIQ_READ_SCOPES = ["ZohoCliq.Channels.READ", "ZohoCliq.Chats.READ", "ZohoCliq.Messages.READ"] as const;
export const ZOHO_CRM_READ_SCOPES = ["ZohoCRM.modules.READ", "ZohoCRM.settings.modules.READ", "ZohoCRM.settings.fields.READ"] as const;

const WRITE_SCOPE_PATTERN = /\.(CREATE|UPDATE|DELETE|ALL)$/i;

export function zohoScopesForProvider(env: AppEnv, provider: CommunicationProvider) {
  const envScopes =
    provider === "zoho_mail"
      ? env.ZOHO_MAIL_SCOPES
      : provider === "zoho_cliq"
        ? env.ZOHO_CLIQ_SCOPES
        : provider === "zoho_crm"
          ? env.ZOHO_CRM_SCOPES
          : [];
  const defaults =
    provider === "zoho_mail"
      ? [...ZOHO_MAIL_READ_SCOPES]
      : provider === "zoho_cliq"
        ? [...ZOHO_CLIQ_READ_SCOPES]
        : provider === "zoho_crm"
          ? [...ZOHO_CRM_READ_SCOPES]
          : [];
  const scopes = envScopes.length > 0 ? envScopes : defaults;
  assertReadOnlyZohoScopes(scopes, provider);
  return scopes;
}

export function assertReadOnlyZohoScopes(scopes: readonly string[], provider: CommunicationProvider) {
  const writeScopes = scopes.filter((scope) => WRITE_SCOPE_PATTERN.test(scope));
  if (writeScopes.length > 0) {
    throw new Error(`Zoho provider ${provider} must use read-only scopes`);
  }
}
