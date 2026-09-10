import { AppError } from "../../../../app/errors.js";
import type { AppEnv } from "../../../../config/env.js";

const SAFE_ACCOUNTS_HOSTS = new Set([
  "accounts.zoho.com",
  "accounts.zoho.eu",
  "accounts.zoho.in",
  "accounts.zoho.com.au",
  "accounts.zoho.jp",
  "accounts.zoho.sa",
  "accounts.zoho.uk",
  "accounts.zoho.com.cn",
  "accounts.zohocloud.ca"
]);

const SAFE_API_HOST_SUFFIXES = [
  ".zoho.com",
  ".zoho.eu",
  ".zoho.in",
  ".zoho.com.au",
  ".zoho.jp",
  ".zoho.sa",
  ".zoho.uk",
  ".zoho.com.cn",
  ".zohocloud.ca"
];

export function resolveZohoAccountsServer(env: AppEnv, candidate?: string | null) {
  const raw = candidate || env.ZOHO_ACCOUNTS_SERVER || "https://accounts.zoho.com";
  const url = new URL(raw);
  if (url.protocol !== "https:" || !SAFE_ACCOUNTS_HOSTS.has(url.hostname.toLowerCase())) {
    throw new AppError(400, "Zoho accounts server is not allowed", "zoho_accounts_server_invalid");
  }
  return `${url.origin}`;
}

export function resolveZohoApiDomain(env: AppEnv, candidate?: string | null, fallbackPath?: "mail" | "cliq" | "crm") {
  const raw =
    candidate ||
    (fallbackPath === "mail"
      ? env.ZOHO_MAIL_API_BASE_URL
      : fallbackPath === "cliq"
        ? env.ZOHO_CLIQ_API_BASE_URL
        : fallbackPath === "crm"
          ? env.ZOHO_CRM_API_BASE_URL
          : undefined) ||
    defaultApiDomain(env, fallbackPath);
  const url = new URL(raw);
  if (url.protocol !== "https:" || !isSafeZohoApiHost(url.hostname)) {
    throw new AppError(400, "Zoho API domain is not allowed", "zoho_api_domain_invalid");
  }
  return url.origin;
}

export function inferZohoDataCenter(accountsServer: string) {
  const host = new URL(accountsServer).hostname.toLowerCase();
  if (host.endsWith(".eu")) return "eu";
  if (host.endsWith(".in")) return "in";
  if (host.endsWith(".com.au")) return "au";
  if (host.endsWith(".jp")) return "jp";
  if (host.endsWith(".sa")) return "sa";
  if (host.endsWith(".uk")) return "uk";
  if (host.endsWith(".com.cn")) return "cn";
  if (host.endsWith(".ca")) return "ca";
  return "us";
}

function defaultApiDomain(env: AppEnv, product?: "mail" | "cliq" | "crm") {
  const accountsServer = resolveZohoAccountsServer(env);
  const dc = inferZohoDataCenter(accountsServer);
  const suffix =
    dc === "eu"
      ? "zoho.eu"
      : dc === "in"
        ? "zoho.in"
        : dc === "au"
          ? "zoho.com.au"
          : dc === "jp"
            ? "zoho.jp"
            : dc === "sa"
              ? "zoho.sa"
              : dc === "uk"
                ? "zoho.uk"
                : dc === "cn"
                  ? "zoho.com.cn"
                  : dc === "ca"
                    ? "zohocloud.ca"
                    : "zoho.com";
  if (product === "mail") return `https://mail.${suffix}`;
  if (product === "cliq") return `https://cliq.${suffix}`;
  return `https://www.${suffix}`;
}

function isSafeZohoApiHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return SAFE_API_HOST_SUFFIXES.some((suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix));
}
