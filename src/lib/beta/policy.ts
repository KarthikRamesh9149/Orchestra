import type { AppEnv } from "../../config/env.js";

export const BETA_DISABLED_CODE = "feature_disabled_in_beta";

export function isMvpBetaMode(env: Pick<AppEnv, "ORCHESTRA_PROFILE" | "MVP_BETA_MODE">) {
  return env.ORCHESTRA_PROFILE === "mvp_beta" || env.MVP_BETA_MODE;
}

export function betaVisibleFeatures() {
  return [
    "memory",
    "communication_memory",
    "socrates",
    "vscode_connector",
    "slack_connector",
    "clickup_connector",
    "granola_connector",
    "fireflies_connector"
  ] as const;
}
