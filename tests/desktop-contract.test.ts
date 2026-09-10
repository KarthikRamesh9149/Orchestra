import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("desktop Step 1 boundary", () => {
  it("records immutable provenance without old history or deployment configuration", () => {
    const manifest = JSON.parse(read("docs/desktop/import-manifest.json"));
    expect(manifest.sourceSha).toBe("8561d41980e97924db33e0c8f748b7cf576aac83");
    expect(manifest.historyImported).toBe(false);
    for (const file of [".github/workflows/ci.yml", ".github/workflows/http-smoke.yml", ".env", ".env.beta.production.example", ".railwayignore"]) expect(existsSync(file), file).toBe(false);
    expect(new Set(manifest.files.map((f: {path:string}) => f.path)).size).toBe(manifest.files.length);
  });

  it("preserves original provenance and requires exact reviewed hashes for authorized evolution", () => {
    const manifest = JSON.parse(read("docs/desktop/import-manifest.json"));
    const adjustments=JSON.parse(read('docs/desktop/import-adjustments.json')).changes as Array<{path:string;sourceSha256:string;importedSha256:string;reason:string}>;
    for (const file of manifest.files) {
      if (file.disposition !== "included") continue;
      if (!/^(src\/|prisma\/|apps\/beta-web\/src\/)/.test(file.path)) continue;
      const adjusted=adjustments.find(a=>a.path===file.path);
      if(adjusted){expect(adjusted.sourceSha256).toBe(file.sourceSha256);expect(adjusted.reason.length).toBeGreaterThan(20);expect(file.path.startsWith('prisma/migrations/')).toBe(false);}
      expect(createHash("sha256").update(readFileSync(file.path)).digest("hex"), file.path).toBe(adjusted?.importedSha256??file.sourceSha256);
    }
  });

  it("assigns every inventoried control an owner, mode and acceptance requirement without claiming completion", () => {
    const inventory = JSON.parse(read("docs/desktop/feature-parity.json"));
    expect(inventory.actions.length).toBeGreaterThan(300);
    expect(new Set(inventory.actions.map((a:{id:string})=>a.id)).size).toBe(inventory.actions.length);
    for (const action of inventory.actions) {
      expect(existsSync(action.source), action.id).toBe(true);
      expect(action.line).toBeGreaterThan(0);
      expect(action.ownerStep).toBeGreaterThanOrEqual(2);
      expect(action.ownerStep).toBeLessThanOrEqual(7);
      expect(action.mode.length).toBeGreaterThan(0);
      expect(action.acceptanceTest.length).toBeGreaterThan(30);
      expect(action.status).toBe("planned-not-desktop-verified");
    }
    expect(inventory.families.length).toBe(18);
  });

  it("keeps publication, signing, licensing and sequential execution explicit", () => {
    expect(read("README.md")).toContain("proposed, not granted or applied");
    expect(read("docs/desktop/CONTRACT.md")).toContain("No automatic progression");
    expect(read("docs/desktop/RELEASE-DEPENDENCIES.md")).toContain("Not confirmed; blocks signed release");
    expect(existsSync("LICENSE")).toBe(false);
  });

  it("retains excluded upstream checks and gives them explicit later owners", () => {
    const checks = JSON.parse(read("docs/desktop/upstream-checks.json"));
    for (const entry of checks.tests) {
      expect(existsSync(entry.file), entry.file).toBe(true);
      expect(entry.ownerStep).toBeGreaterThanOrEqual(1);
      expect(entry.ownerStep).toBeLessThanOrEqual(7);
    }
    for (const file of ["scripts/smoke/beta-browser-smoke.mjs", "scripts/smoke/beta-browser-product-walkthrough.mjs"])
      expect(read(file)).not.toMatch(/const DEFAULT_(?:WEB|API)_URL = "https:\/\//);
  });
});
