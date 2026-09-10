import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const sourceRoot = resolve(root, "apps/beta-web/src");

function productionSourceFiles(directory, relative = "apps/beta-web/src") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (["test", "mock"].includes(entry.name)) return [];
      return productionSourceFiles(absolute, path);
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\.(ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });
}

const productionFiles = productionSourceFiles(sourceRoot);

const forbiddenPatterns = [
  "../lib/mock",
  "lib/mock/dashboard",
  "lib/mock/timeline",
  "lib/mock/suggestions",
  "lib/mock/github",
  "lib/mock/profile",
  "lib/mock/integrations",
  "../lib/mock/dashboard",
  "../lib/mock/timeline",
  "../lib/mock/profile",
  "../lib/mock/integrations",
  "getDashboardStats",
  "getTimelineEvents",
  "getGithubData",
  "getMockUser",
  "getMockWorkspaces",
  "getMockLinked",
  "getMockPrefs",
  "getMockSessions",
  "mockUpdateUser",
  "mockUpdatePref",
  "mockRevokeSession",
  "mockSwitchWorkspace",
  "mockConnectAccount",
  "mockDisconnectAccount",
  "getUserRole",
  "export const setUserRole",
  "TODO: PATCH /v1/users/me profile",
  "MOCK_DOCS",
  "MOCK_CHANNELS",
  "MOCK_CONVERSATIONS",
  "API_MAP_CONTENT",
  "SUMMARY_CONTENT",
  "generateResponse",
  "approvedIds",
  "rejectedIds",
  "fake GitHub",
  "fake Google Calendar",
  "fake Slack",
  "fake Suggestions",
  "fake Profile",
  "fake connected state",
  "fake linked account",
  "fake sessions",
  "BloomFast",
  "a3f9c21",
  "AWS (EC2 + RDS)",
  "BloomFast Standup",
  'import * as mock from "./mockData"',
  'from "./mockData"',
  "VITE_ENABLE_MOCK_API",
  "canUseMockFallback",
  'import("./mock/',
  'from "./mock/',
  "mock-mem-"
];

const forbiddenRegexes = [
  { pattern: /\b20\d{2}-\d{2}-\d{2}(?:T\d{2}:\d{2})?/g, label: "fixed production date" },
  { pattern: /\b(?:demo|sample|fake)\s+(?:user|workspace|activity|provider|identity)\b/gi, label: "fabricated production identity or activity" },
];

const failures = [];

for (const relativeFile of productionFiles) {
  const file = resolve(root, relativeFile);
  const source = readFileSync(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (source.includes(pattern)) {
      failures.push(`${relativeFile}: forbidden production mock marker "${pattern}"`);
    }
  }
  for (const { pattern, label } of forbiddenRegexes) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) failures.push(`${relativeFile}: ${label} "${match[0]}"`);
  }
}

if (failures.length > 0) {
  console.error("Production mock guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production mock guard passed.");
