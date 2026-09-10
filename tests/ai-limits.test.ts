import { describe, expect, it } from "vitest";
import { InMemoryAiLimiter } from "../src/lib/ai-ops/ai-limits.js";

describe("AI production limits", () => {
  it("rate limits per user inside the configured window", async () => {
    const limiter = new InMemoryAiLimiter();
    const first = await limiter.checkRequestLimit({
      key: "user:u1",
      maxRequests: 1,
      windowMs: 60_000,
      nowMs: 100
    });
    const second = await limiter.checkRequestLimit({
      key: "user:u1",
      maxRequests: 1,
      windowMs: 60_000,
      nowMs: 200
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.code).toBe("socrates_rate_limited");
  });

  it("tracks concurrent streams and releases them", async () => {
    const limiter = new InMemoryAiLimiter();
    expect((await limiter.acquireConcurrent("project:p1", 1)).allowed).toBe(true);
    expect((await limiter.acquireConcurrent("project:p1", 1)).allowed).toBe(false);
    await limiter.releaseConcurrent("project:p1");
    expect((await limiter.acquireConcurrent("project:p1", 1)).allowed).toBe(true);
  });

  it("blocks daily cost budgets", async () => {
    const limiter = new InMemoryAiLimiter();
    expect((await limiter.checkDailyCost({ key: "project:p1", maxDailyCostUsd: 0.02, addCostUsd: 0.01 })).allowed).toBe(true);
    const blocked = await limiter.checkDailyCost({ key: "project:p1", maxDailyCostUsd: 0.02, addCostUsd: 0.02 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe("socrates_cost_budget_exceeded");
  });

  it("reserves project and user cost atomically", async () => {
    const limiter = new InMemoryAiLimiter();
    await limiter.checkDailyCost({ key: "user:u1", maxDailyCostUsd: 0.01, addCostUsd: 0.01 });
    const blocked = await limiter.checkDailyCosts([
      { key: "project:p1", maxDailyCostUsd: 0.02, addCostUsd: 0.01 },
      { key: "user:u1", maxDailyCostUsd: 0.01, addCostUsd: 0.01 }
    ]);
    expect(blocked).toMatchObject({ allowed: false, deniedKey: "user:u1" });
    const projectReservation = await limiter.checkDailyCost({ key: "project:p1", maxDailyCostUsd: 0.02, addCostUsd: 0.02 });
    expect(projectReservation.allowed).toBe(true);
  });
});
