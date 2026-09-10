import type { DeliveryEvidence } from "./types.js";

function kind(item: DeliveryEvidence) { return item.id.split(":")[1]?.replace(/^github_/, "") ?? ""; }
export function isImplementationEvidence(item: DeliveryEvidence) {
  return ["commit", "push"].includes(kind(item)) || kind(item) === "pull_request" && item.status === "merged";
}
export function isTestEvidence(item: DeliveryEvidence) {
  return ["test", "ci_test", "ci_check", "check", "check_run", "check_suite", "workflow_run"].includes(kind(item));
}
export function isDeploymentEvidence(item: DeliveryEvidence) {
  return ["deployment", "deployment_status"].includes(kind(item));
}

export function isBlockingSeverity(severity: string) {
  return ["blocking", "high", "critical"].includes(severity);
}

export function isPassingEvidence(item: DeliveryEvidence) {
  return ["success", "succeeded", "passed"].includes(item.status?.toLowerCase() ?? "");
}

export function isSuccessfulDeployment(item: DeliveryEvidence) {
  return isPassingEvidence(item) && ["production", "prod"].includes(item.environment?.toLowerCase() ?? "");
}

export function sameRevision(a: DeliveryEvidence, b: DeliveryEvidence) {
  return Boolean(a.sha && /^[a-f0-9]{40}$/i.test(a.sha) && a.sha.toLowerCase() === b.sha?.toLowerCase()
    && a.repository && a.repository.toLowerCase() === b.repository?.toLowerCase());
}

export function runMatchesEvidence(run: { commitSha: string | null; prUrl: string | null }, item: DeliveryEvidence) {
  let repository: string | null = null;
  try {
    const url = new URL(run.prUrl ?? "");
    if (url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)) {
      repository = url.pathname.split("/").slice(1, 3).join("/");
    }
  } catch { /* Missing repository identity cannot certify delivery. */ }
  return sameRevision({ ...item, sha: run.commitSha, repository }, item);
}
