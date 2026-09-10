import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const modulesDir = path.join(repoRoot, "src", "modules");

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(fullPath);
    return entry.isFile() && entry.name.endsWith("routes.ts") ? [fullPath] : [];
  });
}

function normalizePath(filePath: string) {
  return filePath.replaceAll("\\", "/");
}

describe("route authentication boundaries", () => {
  it("keeps internal route modules behind internalAuthGuard while allowing identity-owned /me routes", () => {
    const publicAuthRouteFile = normalizePath(path.join(modulesDir, "auth", "routes.ts"));
    const identityOwnedRouteFile = normalizePath(path.join(modulesDir, "me", "me.routes.ts"));
    const offenders = routeFiles(modulesDir)
      .filter((filePath) => normalizePath(filePath) !== publicAuthRouteFile)
      .filter((filePath) => normalizePath(filePath) !== identityOwnedRouteFile)
      .filter((filePath) => /\bapp\.(get|post|patch|put|delete)\s*\(/.test(fs.readFileSync(filePath, "utf8")))
      .filter((filePath) => !fs.readFileSync(filePath, "utf8").includes("internalAuthGuard"))
      .map((filePath) => path.relative(repoRoot, filePath).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
    const identityOwnedRoutes = fs.readFileSync(identityOwnedRouteFile, "utf8");
    expect(identityOwnedRoutes).toContain("authGuard(");
    expect(identityOwnedRoutes).not.toContain("internalAuthGuard");
  });
});
