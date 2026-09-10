import type { AppEnv } from "../../config/env.js";
import { isMvpBetaMode } from "../beta/policy.js";

export const advertisedProviderKeys = [
  "slack",
  "microsoft_teams",
  "notion",
  "google_drive",
  "google_calendar",
  "github",
  "fireflies_ai",
  "clickup",
  "granola",
  "zoho_mail",
  "zoho_cliq",
  "zoho_crm",
  "vscode"
] as const;

export type AdvertisedProviderKey = (typeof advertisedProviderKeys)[number];

// VS Code is the only default because it is an Orchestra-owned protocol. An
// operator may add external providers only after credential-backed staging and
// production validation. Unknown provider names are rejected by env parsing.
const DEFAULT_LIVE_VALIDATED_PROVIDERS: AdvertisedProviderKey[] = ["vscode"];

export function isAdvertisedProviderKey(provider: string): provider is AdvertisedProviderKey {
  return (advertisedProviderKeys as readonly string[]).includes(provider);
}

export function requiresProviderReleaseValidation(
  env: Pick<AppEnv, "NODE_ENV" | "ORCHESTRA_PROFILE" | "MVP_BETA_MODE">
) {
  return env.NODE_ENV === "production" && isMvpBetaMode(env);
}

export function isProviderReleaseValidated(
  env: Pick<AppEnv, "NODE_ENV" | "ORCHESTRA_PROFILE" | "MVP_BETA_MODE"> &
    Partial<Pick<AppEnv, "PROVIDER_RELEASE_VALIDATED_PROVIDERS">>,
  provider: string
) {
  const liveValidatedProviders = new Set<AdvertisedProviderKey>(
    env.PROVIDER_RELEASE_VALIDATED_PROVIDERS ?? DEFAULT_LIVE_VALIDATED_PROVIDERS
  );
  return !requiresProviderReleaseValidation(env) ||
    (isAdvertisedProviderKey(provider) && liveValidatedProviders.has(provider));
}

export const PROVIDER_RELEASE_VALIDATION_REASON = "provider_live_validation_required";
