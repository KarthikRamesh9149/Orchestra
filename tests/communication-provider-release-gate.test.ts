import { describe, expect, it } from "vitest";
import { evaluateCommunicationProviderReleaseGate } from "../scripts/ops/communication-provider-release-gate.js";

describe("Slack, ClickUp, Granola, and Microsoft Teams communication provider release gate", () => {
  it("blocks launch proof when live DB and HTTP smoke proof are missing", async () => {
    const report = await evaluateCommunicationProviderReleaseGate({
      profile: "mvp",
      allowMissingLiveDb: false,
      allowMissingHttpSmoke: false
    });

    expect(report.status).toBe("blocked");
    expect(report.canBeUsedForLaunchProof).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining(["Live Supabase schema/drift verification is required before Slack/ClickUp/Granola/Teams rollout."])
    );
  });

  it("passes as a diagnostic gate when static Slack/ClickUp/Granola/Teams hardening checks pass", async () => {
    const report = await evaluateCommunicationProviderReleaseGate({
      profile: "mvp",
      allowMissingLiveDb: true,
      allowMissingHttpSmoke: true
    });

    expect(report.status).toBe("diagnostic_passed");
    expect(report.steps.every((step) => step.status === "passed")).toBe(true);
    expect(report.proof.staticChecksPassed).toBe(true);
    expect(report.proof.mvpProviderProfile).toEqual([
      "manual_import",
      "fireflies_ai",
      "slack",
      "clickup",
      "granola",
      "microsoft_teams"
    ]);
  });
});
