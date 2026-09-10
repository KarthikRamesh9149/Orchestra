import { describe, expect, it, vi } from "vitest";
import { startEmbeddedWorker } from "../src/lib/jobs/embedded-worker.js";

vi.mock("../src/lib/jobs/queue.js", () => ({
  registerWorker: vi.fn(() => ({ on: vi.fn() }))
}));

vi.mock("../src/lib/jobs/handlers.js", () => ({
  createJobHandlers: vi.fn(() => ({}))
}));

describe("embedded BullMQ worker", () => {
  it("stays disabled by default", () => {
    const context = { env: { ORCHESTRA_EMBED_WORKER: false } } as never;
    expect(startEmbeddedWorker(context)).toBeNull();
  });

  it("registers the existing worker against the API context when enabled", async () => {
    const { registerWorker } = await import("../src/lib/jobs/queue.js");
    const context = {
      env: { ORCHESTRA_EMBED_WORKER: true, QUEUE_PREFIX: "orchestra" },
      logger: { error: vi.fn() }
    } as never;

    expect(startEmbeddedWorker(context)).not.toBeNull();
    expect(registerWorker).toHaveBeenCalledWith(context, "orchestra-jobs", {});
  });
});
