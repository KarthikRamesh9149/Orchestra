import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/config/env.js";
import { shouldUseInlineJobs } from "../src/setup-context.js";

function env(overrides: Partial<AppEnv>): AppEnv {
  return {
    QUEUE_MODE: "bullmq",
    ORCHESTRA_PROFILE: "full",
    STORAGE_DRIVER: "s3",
    ...overrides
  } as AppEnv;
}

describe("beta Railway job topology", () => {
  it("runs jobs inline for beta deployments that use local file storage", () => {
    expect(
      shouldUseInlineJobs(
        env({
          ORCHESTRA_PROFILE: "mvp_beta",
          QUEUE_MODE: "bullmq",
          STORAGE_DRIVER: "local"
        })
      )
    ).toBe(true);
  });

  it("keeps BullMQ for beta deployments backed by shared object storage", () => {
    expect(
      shouldUseInlineJobs(
        env({
          ORCHESTRA_PROFILE: "mvp_beta",
          QUEUE_MODE: "bullmq",
          STORAGE_DRIVER: "s3"
        })
      )
    ).toBe(false);
  });
});
