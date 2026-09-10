import { describe, expect, it } from "vitest";
import { normalizeBullMqJobId } from "../src/lib/jobs/queue.js";

describe("job queue ids", () => {
  it("normalizes colon-delimited idempotency keys for BullMQ custom job ids", () => {
    expect(normalizeBullMqJobId("project:abc:brain-rebuild")).toBe("project|abc|brain-rebuild");
  });

  it("preserves deterministic ids that are already BullMQ-safe", () => {
    expect(normalizeBullMqJobId("project-abc-brain-rebuild")).toBe("project-abc-brain-rebuild");
  });
});
