import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveServiceCommands } from "../scripts/start-service-plan.mjs";

describe("service process selection", () => {
  it("executes the production launcher unconditionally when Node loads the entrypoint", () => {
    const launcher = readFileSync(new URL("../scripts/start-service.mjs", import.meta.url), "utf8");
    expect(launcher).toMatch(/\nstartService\(\);\s*$/);
    expect(launcher).not.toContain("pathToFileURL");
  });

  it("starts only the static frontend for beta-web", () => {
    expect(resolveServiceCommands({ RAILWAY_SERVICE_NAME: "beta-web" })).toEqual([
      ["node", ["apps/beta-web/server.mjs"]]
    ]);
  });

  it("starts only the worker for the dedicated worker service", () => {
    expect(resolveServiceCommands({ RAILWAY_SERVICE_NAME: "orchestra-worker" })).toEqual([
      ["node", ["dist/src/worker.js"]]
    ]);
  });

  it("starts only the API by default", () => {
    expect(resolveServiceCommands({ RAILWAY_SERVICE_NAME: "orchestrav2", DATABASE_URL: "postgresql://local" })).toEqual([
      ["node", ["dist/src/server.js"]]
    ]);
  });

  it("never supervises a second Node process in the API container", () => {
    expect(resolveServiceCommands({
      RAILWAY_SERVICE_NAME: "orchestrav2",
      DATABASE_URL: "postgresql://local",
      ORCHESTRA_COLOCATE_WORKER: "true"
    })).toEqual([
      ["node", ["dist/src/server.js"]]
    ]);
  });

  it("never starts a backend worker in the static frontend service", () => {
    expect(resolveServiceCommands({
      RAILWAY_SERVICE_NAME: "beta-web",
      ORCHESTRA_COLOCATE_WORKER: "true"
    })).toEqual([["node", ["apps/beta-web/server.mjs"]]]);
  });
});
