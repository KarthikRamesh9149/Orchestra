import { describe, expect, it } from "vitest";
import { isMvpBetaMode, betaVisibleFeatures } from "../src/lib/beta/policy.js";

describe("mvp beta policy", () => {
  it("enables beta from ORCHESTRA_PROFILE", () => {
    expect(isMvpBetaMode({ ORCHESTRA_PROFILE: "mvp_beta", MVP_BETA_MODE: false } as any)).toBe(true);
  });

  it("keeps the visible feature set narrow", () => {
    expect(betaVisibleFeatures()).toEqual([
      "memory",
      "communication_memory",
      "socrates",
      "vscode_connector",
      "slack_connector",
      "clickup_connector",
      "granola_connector",
      "fireflies_connector"
    ]);
  });
});
