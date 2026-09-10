import { expect, it } from "vitest";
import * as database from "../src/db/prisma.js";

it("does not serve requests until every database warmup read completes", async () => {
  const start = database.startAfterDatabaseReady;
  expect(start, "startup must gate serving on database readiness").toBeTypeOf("function");
  const releases: (() => void)[] = [];
  let serving = false;
  const pending = start(() => new Promise<void>(resolve => releases.push(resolve)), async () => { serving = true; });
  expect(serving).toBe(false);
  expect(releases).toHaveLength(3);
  releases[0](); releases[1]();
  await Promise.resolve();
  expect(serving).toBe(false);
  releases[2]();
  await pending;
  expect(serving).toBe(true);
});

it("does not start serving when a database connection fails", async () => {
  const start = database.startAfterDatabaseReady;
  expect(start).toBeTypeOf("function");
  let serving = false;
  await expect(start(async () => { throw new Error("database unavailable"); }, async () => { serving = true; }))
    .rejects.toThrow("database unavailable");
  expect(serving).toBe(false);
});
