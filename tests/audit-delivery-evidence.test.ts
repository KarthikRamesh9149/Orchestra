import { describe, it, expect } from "vitest";
import { isBlockingSeverity, isSuccessfulDeployment, isPassingEvidence, sameRevision, runMatchesEvidence } from "../src/modules/delivery/evidence-policy.js";
import type { DeliveryEvidence } from "../src/modules/delivery/types.js";
const evidence = (status: string): DeliveryEvidence => ({ id: "github:deployment:1", label: "Production deployment", detail: "Deployment completed to production", status, occurredAt: null, openTarget: null, environment: "production", sha: "a".repeat(40), repository: "owner/repo" });
describe("audit delivery trust boundaries", () => {
  it.each(["queued", "pending", "in_progress", "completed", "failed", "cancelled", "not_successful", "inactive", "unknown"])("does not certify %s", (status) => {
    expect(isSuccessfulDeployment(evidence(status))).toBe(false);
    expect(isPassingEvidence(evidence(status))).toBe(false);
  });
  it("requires production, an exact revision, and the same repository", () => {
    const deployment = evidence("success");
    expect(isSuccessfulDeployment(deployment)).toBe(true);
    expect(isSuccessfulDeployment({ ...deployment, environment: "staging" })).toBe(false);
    expect(sameRevision(deployment, { ...deployment, sha: "b".repeat(40) })).toBe(false);
    expect(sameRevision(deployment, { ...deployment, repository: "owner/other" })).toBe(false);
    expect(runMatchesEvidence({ commitSha: deployment.sha!, prUrl: "https://github.com/owner/repo/pull/1" }, deployment)).toBe(true);
    expect(runMatchesEvidence({ commitSha: deployment.sha!, prUrl: null }, deployment)).toBe(false);
  });
  it("recognizes FDE's actual persisted blocking severity", () => {
    expect(isBlockingSeverity("blocking")).toBe(true);
    expect(isBlockingSeverity("watch")).toBe(false);
    expect(isBlockingSeverity("info")).toBe(false);
  });
});
