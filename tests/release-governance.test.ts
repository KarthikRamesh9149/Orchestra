import { describe, expect, it, vi } from "vitest";
import {
  assertDeploymentAllowed,
  validateReleaseGovernance
} from "../scripts/ops/validate-release-governance.js";

describe("release governance", () => {
  it("requires complete CI evidence and keeps production deployment frozen", () => {
    const policy = validateReleaseGovernance();
    expect(policy.requiredChecks).toEqual([
      "quality-and-security",
      "frontend-browser-tests",
      "fresh-database-migrations",
      "release-runtime-proof"
    ]);
    expect(policy.mergeGate.requiredFinalFix).toBe(35);
    expect(policy.productionDeployment.automaticSourceConnected).toBe(false);
  });

  it("allows the remediation branch to deploy only to staging", () => {
    expect(() => assertDeploymentAllowed("staging", "mvp-beta-beta-beta-beta", false)).not.toThrow();
    expect(() => assertDeploymentAllowed("staging", "codex/mvp-beta-beta-audit-20260824", false)).not.toThrow();
    expect(() => assertDeploymentAllowed("staging", "codex/reaudit-d7e311e", false)).not.toThrow();
    expect(() => assertDeploymentAllowed("production", "codex/reaudit-d7e311e", true)).toThrow(/only the production branch/);
    expect(() => assertDeploymentAllowed("staging", "mvp-beta-beta", false)).toThrow(/explicitly isolated/);
    expect(() => assertDeploymentAllowed("production", "mvp-beta-beta-beta-beta", true)).toThrow(
      /only the production branch/
    );
  });

  it("requires explicit approval even from the production branch", () => {
    const stagingParity = vi.fn();
    expect(() => assertDeploymentAllowed("production", "mvp-beta-beta", false)).toThrow(/manual approval/);
    expect(() => assertDeploymentAllowed("production", "mvp-beta-beta", true, stagingParity)).not.toThrow();
    expect(stagingParity).toHaveBeenCalledOnce();
  });
});
