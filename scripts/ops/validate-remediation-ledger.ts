import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const LEDGER_PATH = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
  "docs/remediation/remediation-ledger.json"
);
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const ACTION_STATUSES = new Set(["open", "verified", "navigation_only", "local_ui_only"]);
const ISSUE_STATUSES = new Set(["open", "verified", "external_blocker"]);
const ACTION_KINDS = new Set(["read", "mutation", "navigation", "local_state", "download"]);

type Entry = Record<string, unknown>;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertUnique(entries: Entry[], label: string): void {
  const ids = entries.map((entry) => entry.id);
  if (ids.some((id) => !nonEmpty(id))) throw new Error(`${label} contains an entry without an id`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ids`);
}

export function validateRemediationLedger(path = LEDGER_PATH): { issues: number; actions: number; surfaces: number } {
  const ledger = JSON.parse(readFileSync(path, "utf8")) as Entry;
  if (ledger.schemaVersion !== 1) throw new Error("ledger schemaVersion must be 1");
  if (!nonEmpty(ledger.generatedFrom) || !/^mvp-beta-beta@[0-9a-f]{40}$/.test(ledger.generatedFrom)) {
    throw new Error("ledger generatedFrom must identify an exact mvp-beta-beta commit");
  }

  const issues = ledger.issues;
  const actions = ledger.actions;
  if (!Array.isArray(issues) || issues.length < 35) throw new Error("ledger must contain at least one issue per remediation package");
  if (!Array.isArray(actions) || actions.length < 50) throw new Error("ledger must contain the complete production action inventory");
  assertUnique(issues, "issues");
  assertUnique(actions, "actions");

  const coveredFixes = new Set<number>();
  for (const issue of issues) {
    const fix = issue.fix;
    if (!Number.isInteger(fix) || Number(fix) < 1 || Number(fix) > 35) throw new Error(`issue ${String(issue.id)} has an invalid fix`);
    coveredFixes.add(Number(fix));
    if (!ISSUE_STATUSES.has(String(issue.status))) throw new Error(`issue ${String(issue.id)} has an invalid status`);
    for (const field of ["title", "severity", "evidence", "acceptance"]) {
      if (!nonEmpty(issue[field])) throw new Error(`issue ${String(issue.id)} is missing ${field}`);
    }
    if (issue.status === "verified" && !nonEmpty(issue.proof)) throw new Error(`verified issue ${String(issue.id)} is missing proof`);
  }
  for (let fix = 1; fix <= 35; fix += 1) {
    if (!coveredFixes.has(fix)) throw new Error(`fix ${fix} has no issue entry`);
  }
  const releaseIssue = issues.find((issue) => issue.fix === 35);
  if (releaseIssue?.status !== "verified" || !nonEmpty(releaseIssue.proof)) {
    throw new Error("fix 35 must retain verified production release proof");
  }

  const surfaces = new Set<string>();
  for (const action of actions) {
    const id = String(action.id);
    if (!ACTION_STATUSES.has(String(action.status))) throw new Error(`action ${id} has an invalid status`);
    if (!ACTION_KINDS.has(String(action.kind))) throw new Error(`action ${id} has an invalid kind`);
    for (const field of ["surface", "control", "frontend", "handler", "api", "route", "authorization", "service", "models", "test", "reloadProof"]) {
      if (!nonEmpty(action[field])) throw new Error(`action ${id} is missing ${field}`);
    }
    if (!Number.isInteger(action.fix) || Number(action.fix) < 1 || Number(action.fix) > 35) {
      throw new Error(`action ${id} has an invalid fix`);
    }
    if (!existsSync(resolve(REPOSITORY_ROOT, String(action.frontend)))) {
      throw new Error(`action ${id} references a missing frontend file`);
    }
    surfaces.add(String(action.surface));

    if (action.status === "verified") {
      for (const field of ["api", "route", "authorization", "service", "models", "test", "reloadProof"]) {
        const value = String(action[field]).toLowerCase();
        if (value.includes("pending") || value.startsWith("none") || value.startsWith("n/a")) {
          throw new Error(`verified action ${id} has non-authoritative ${field}`);
        }
      }
    }
    if (action.kind === "mutation" && action.status === "navigation_only") {
      throw new Error(`mutation ${id} cannot be navigation_only`);
    }
  }

  const requiredSurfaces = ["Authentication", "Workspaces", "Navigation", "Dashboard", "Chat", "Memory", "Timeline", "Deep Research", "Settings", "Live Document"];
  for (const surface of requiredSurfaces) {
    if (!surfaces.has(surface)) throw new Error(`missing required surface: ${surface}`);
  }

  return { issues: issues.length, actions: actions.length, surfaces: surfaces.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateRemediationLedger();
  console.log(`Remediation ledger valid: ${result.issues} issues, ${result.actions} actions, ${result.surfaces} surfaces.`);
}
