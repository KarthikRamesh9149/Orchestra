import { describe, expect, it } from "vitest";
import { validateRemediationLedger } from "../scripts/ops/validate-remediation-ledger.js";

describe("remediation ledger", () => {
  it("covers every fix and visible beta surface with enforceable mappings", () => {
    const result = validateRemediationLedger();
    expect(result.issues).toBeGreaterThanOrEqual(35);
    expect(result.actions).toBeGreaterThanOrEqual(50);
    expect(result.surfaces).toBeGreaterThanOrEqual(10);
  });
});
