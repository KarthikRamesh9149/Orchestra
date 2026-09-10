import { describe, expect, it } from "vitest";
import * as diagnostics from "../src/db/prisma.js";

describe("staging dependency timing", () => {
  it("does not probe production or expose dependency error details", async () => {
    const run = (diagnostics as any).measureStagingDatabaseLatency;
    expect(typeof run).toBe("function");
    let calls = 0;
    const probe = async () => { calls++; throw new Error("secret connection URL"); };
    expect(await run("production", probe)).toBeNull();
    expect(calls).toBe(0);
    const result = await run("staging", probe);
    expect(result).toEqual({ ok: false, samplesMs: [] });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("records three sequential round trips without returning query data", async () => {
    const run = (diagnostics as any).measureStagingDatabaseLatency;
    expect(typeof run).toBe("function");
    let clock = 0;
    const result = await run("staging", async () => { clock += 80; return "private"; }, () => clock);
    expect(result).toEqual({ ok: true, samplesMs: [80, 80, 80] });
  });
});
