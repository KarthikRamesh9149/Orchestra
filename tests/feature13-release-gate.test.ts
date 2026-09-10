import { describe, expect, it } from "vitest";
import { evaluateFeature13ReleaseGate } from "../scripts/ops/feature13-release-gate.js";

describe("Feature 13 release gate", () => {
  it("blocks launch when live Supabase schema proof is missing", async () => {
    const report = await evaluateFeature13ReleaseGate({ profile: "mvp", allowMissingLiveDb: false });

    expect(report.status).toBe("blocked");
    expect(report.blockers).toContain("Live Supabase schema/drift verification is required before release.");
    expect(report.canBeUsedForLaunchProof).toBe(false);
  });

  it("passes as a diagnostic dry-run when static hardening checks pass", async () => {
    const report = await evaluateFeature13ReleaseGate({ profile: "mvp", allowMissingLiveDb: true });

    expect(report.status).toBe("diagnostic_passed");
    expect(report.steps.every((step) => step.status === "passed")).toBe(true);
    expect(report.proof.dashboardReadinessFirst).toBe(true);
    expect(report.proof.noGithubWritesFromFeature13).toBe(true);
    expect(report.proof.noTruthMutationFromFeature13).toBe(true);
    expect(report.proof.mvpHiddenProviderGating).toBe(true);
  });
});
