import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RouteContract = { path: string; component: string; access: string };
type RedirectContract = { path: string; destination: string };
type ContractFamily = {
  name: string;
  frontendSources: string[];
  backendSources: string[];
  frontendExports: string[];
  frontendTokens: string[];
  backendTokens: string[];
};
type CurrentProductContract = {
  schemaVersion: number;
  canonicalDocument: string;
  frontend: { appSource: string; routes: RouteContract[]; redirects: RedirectContract[] };
  contractFamilies: ContractFamily[];
  database: {
    prismaSchema: string;
    migrationRoot: string;
    supabaseManifest: string;
    supabaseManifestScope: "verified_baseline_snapshot";
    generatedContract: string;
  };
};

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(root: string, relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function exported(source: string, name: string) {
  return new RegExp(`export\\s+(?:type|interface|class|const)\\s+${name}\\b`).test(source) ||
    new RegExp(`export\\s+type\\s*\\{[^}]*\\b${name}\\b`, "s").test(source);
}

function routeUsesComponent(app: string, route: RouteContract) {
  const escapedPath = route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedComponent = route.component.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<Route\\s+path="${escapedPath}"\\s+element=\\{(?:<Deferred>)?<${escapedComponent}`
  ).test(app);
}

function countApiRoutes(root: string) {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith("routes.ts") || entry.name === "build-app.ts") files.push(absolute);
    }
  };
  walk(path.join(root, "src"));
  const routePattern = /app\.(get|post|patch|put|delete)\(\s*(?:\{[^}]*\}\s*,\s*)?["']([^"']+)["']/gs;
  return files.reduce((count, file) => count + [...readFileSync(file, "utf8").matchAll(routePattern)].length, 0);
}

export function validateCurrentProductContracts(root = defaultRoot) {
  const errors: string[] = [];
  const contract = JSON.parse(read(root, "docs/current-product-contract.json")) as CurrentProductContract;
  const canonical = read(root, contract.canonicalDocument);
  const app = read(root, contract.frontend.appSource);
  const appRoutes = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]));

  for (const route of contract.frontend.routes) {
    if (!appRoutes.has(route.path)) errors.push(`Frontend route missing from App.tsx: ${route.path}`);
    if (!routeUsesComponent(app, route)) errors.push(`Frontend route component missing: ${route.path} -> ${route.component}`);
    if (!canonical.includes(`\`${route.path}\``)) errors.push(`Canonical document omits frontend route: ${route.path}`);
  }
  for (const redirect of contract.frontend.redirects) {
    if (!appRoutes.has(redirect.path)) errors.push(`Redirect source missing from App.tsx: ${redirect.path}`);
    if (!app.includes(`to="${redirect.destination}"`)) errors.push(`Redirect destination missing from App.tsx: ${redirect.destination}`);
  }

  for (const family of contract.contractFamilies) {
    for (const source of [...family.frontendSources, ...family.backendSources]) {
      if (!existsSync(path.join(root, source))) errors.push(`${family.name} source does not exist: ${source}`);
    }
    const frontend = family.frontendSources.filter((source) => existsSync(path.join(root, source))).map((source) => read(root, source)).join("\n");
    const backend = family.backendSources.filter((source) => existsSync(path.join(root, source))).map((source) => read(root, source)).join("\n");
    for (const name of family.frontendExports) {
      if (!exported(frontend, name)) errors.push(`${family.name} frontend export is missing: ${name}`);
    }
    for (const token of family.frontendTokens) {
      if (!frontend.includes(token)) errors.push(`${family.name} frontend route token is missing: ${token}`);
    }
    for (const token of family.backendTokens) {
      if (!backend.includes(token)) errors.push(`${family.name} backend route token is missing: ${token}`);
    }
  }

  const prisma = read(root, contract.database.prismaSchema);
  const modelCount = [...prisma.matchAll(/^model\s+\w+\s+\{/gm)].length;
  const enumCount = [...prisma.matchAll(/^enum\s+\w+\s+\{/gm)].length;
  const migrationCount = readdirSync(path.join(root, contract.database.migrationRoot), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  const routeCount = countApiRoutes(root);
  const staging = JSON.parse(read(root, contract.database.supabaseManifest)) as {
    supabase?: { canonicalMigrations?: number };
    contractProof?: {
      prismaModels?: number;
      prismaEnums?: number;
      canonicalMigrations?: number;
      supabaseSuccessfulCanonicalMigrations?: number;
      supabasePendingCanonicalMigrations?: number;
      supabasePublicApplicationTables?: number;
      supabaseGeneratedTableTypesIncludingMigrationHistory?: number;
      supabaseAllApplicationTablesRlsEnabled?: boolean;
      apiRoutes?: number;
      frontendCanonicalRoutes?: number;
      contractFamilies?: number;
    };
  };
  const generated = read(root, contract.database.generatedContract);

  if (contract.database.supabaseManifestScope !== "verified_baseline_snapshot") {
    errors.push("Supabase manifest scope must identify the evidence as a verified baseline snapshot");
  }
  const proof = staging.contractProof;
  const baselineMigrations = proof?.canonicalMigrations;
  const baselineModels = proof?.prismaModels;
  const expectedBaselineProof: Record<string, number | boolean | undefined> = {
    supabaseSuccessfulCanonicalMigrations: baselineMigrations,
    supabasePendingCanonicalMigrations: 0,
    supabasePublicApplicationTables: baselineModels,
    supabaseGeneratedTableTypesIncludingMigrationHistory:
      typeof baselineModels === "number" ? baselineModels + 1 : undefined,
    supabaseAllApplicationTablesRlsEnabled: true,
  };
  if (staging.supabase?.canonicalMigrations !== baselineMigrations) {
    errors.push("Supabase baseline manifest and its recorded migration proof disagree");
  }
  if (typeof baselineMigrations !== "number" || baselineMigrations > migrationCount) {
    errors.push(`Supabase baseline migration proof cannot exceed repository migrations: ${String(baselineMigrations)} > ${migrationCount}`);
  }
  for (const [field, value] of Object.entries(expectedBaselineProof)) {
    if (proof?.[field as keyof typeof proof] !== value) errors.push(`Supabase baseline proof is internally inconsistent: ${field} must be ${String(value)}`);
  }
  for (const [generatedCount, canonicalCount] of [
    [`Prisma model count: ${modelCount}`, `Prisma model count: **${modelCount}**`],
    [`Prisma enum count: ${enumCount}`, `Prisma enum count: **${enumCount}**`],
    [`Migration count: ${migrationCount}`, `Migration count: **${migrationCount}**`],
  ]) {
    if (!generated.includes(generatedCount)) errors.push(`Generated schema contract is stale: ${generatedCount}`);
    if (!canonical.includes(canonicalCount)) errors.push(`Canonical document count is stale: ${canonicalCount}`);
  }
  if (!canonical.includes(`API route count: **${routeCount}**`)) errors.push(`Canonical document API route count is stale: ${routeCount}`);

  const requiredLinks = ["README.md", "docs/README.md", "docs/PROJECT_README.md", "docs/FRONTEND_DB_LAUNCH_GUIDE.md"];
  for (const document of requiredLinks) {
    if (!read(root, document).includes("CURRENT_PRODUCT.md")) errors.push(`${document} does not link to docs/CURRENT_PRODUCT.md`);
  }
  const activeDocs = ["README.md", "docs/README.md", "docs/PROJECT_README.md", "docs/FRONTEND_DB_LAUNCH_GUIDE.md", "docs/FRONTEND_CONTRACT.md", "docs/API_SPEC.md", "docs/feature1.md"];
  const staleClaims = [
    "Frontend source is intentionally not included",
    "does not currently include production frontend source",
    "Production frontend source is not included",
    "exposes Project Memory, Socrates document-memory ask, and VS Code connector APIs only",
  ];
  for (const document of activeDocs) {
    const content = read(root, document);
    for (const claim of staleClaims) if (content.includes(claim)) errors.push(`${document} retains obsolete claim: ${claim}`);
  }

  if (errors.length > 0) throw new Error(`Current-product contract validation failed:\n- ${errors.join("\n- ")}`);
  return { routes: contract.frontend.routes.length, redirects: contract.frontend.redirects.length, contractFamilies: contract.contractFamilies.length, modelCount, enumCount, migrationCount, routeCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateCurrentProductContracts();
  console.log(`Current-product contracts verified: ${result.routes} frontend routes, ${result.redirects} redirects, ${result.contractFamilies} API families, ${result.modelCount} Prisma models, ${result.enumCount} enums, ${result.migrationCount} canonical migrations, ${result.routeCount} API routes.`);
}
