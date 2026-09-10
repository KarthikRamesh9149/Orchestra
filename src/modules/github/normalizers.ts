import { createHash } from "node:crypto";

const MAX_TEXT_LENGTH = 4000;
const SECRET_VALUE_PATTERN =
  /\b(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const SECRET_KEY_PATTERN = /token|secret|authorization|private[_-]?key|access[_-]?key|password|oauth|rawBody/i;

export type NormalizedGitHubEvidence = {
  evidenceType:
    | "github_repository"
    | "github_branch"
    | "github_pull_request"
    | "github_pull_request_file"
    | "github_commit"
    | "github_commit_file"
    | "github_review"
    | "github_review_comment"
    | "github_issue_comment"
    | "github_check_run"
    | "github_deployment"
    | "github_deployment_status"
    | "github_workflow_run";
  providerId: string;
  title?: string | null;
  summary?: string | null;
  branch?: string | null;
  sha?: string | null;
  pullRequestNumber?: number | null;
  path?: string | null;
  status?: string | null;
  actorGithubUserId?: string | null;
  actorGithubLogin?: string | null;
  sourceUrl?: string | null;
  occurredAt?: Date | null;
  payload: Record<string, unknown>;
};

type GitHubRepositoryPayload = {
  id?: number | string;
  name?: string;
  full_name?: string;
  default_branch?: string;
  private?: boolean;
  fork?: boolean;
  html_url?: string;
  owner?: {
    id?: number | string;
    login?: string;
    type?: string;
  };
};

export function normalizeRepository(payload: unknown) {
  const repository = asRecord(payload) as GitHubRepositoryPayload;
  const fullName = repository.full_name ?? joinFullName(repository.owner?.login, repository.name);
  return {
    githubRepositoryId: toProviderId(repository.id),
    owner: repository.owner?.login ?? splitOwner(fullName),
    name: repository.name ?? splitName(fullName),
    fullName,
    defaultBranch: repository.default_branch ?? null,
    private: Boolean(repository.private),
    fork: Boolean(repository.fork),
    htmlUrl: typeof repository.html_url === "string" ? repository.html_url : null
  };
}

export function normalizeInstallation(payload: unknown) {
  const body = asRecord(payload);
  const installation = asRecord(body.installation);
  const account = asRecord(installation.account);
  return {
    githubInstallationId: toProviderId(installation.id),
    githubAccountId: toOptionalProviderId(account.id),
    githubAccountLogin: stringOrNull(account.login),
    githubAccountType: stringOrNull(account.type),
    repositorySelection: stringOrNull(installation.repository_selection),
    permissions: asRecord(installation.permissions),
    events: Array.isArray(installation.events) ? installation.events.filter((item) => typeof item === "string") : [],
    installedAt: dateOrNull(installation.created_at),
    suspendedAt: dateOrNull(installation.suspended_at)
  };
}

export function normalizeWebhookEvidence(eventType: string, payload: unknown): NormalizedGitHubEvidence[] {
  const body = asRecord(payload);
  const repository = normalizeRepository(body.repository);
  const actor = normalizeActor(body.sender);
  const action = stringOrNull(body.action);

  switch (eventType) {
    case "installation":
    case "installation_repositories":
      return [];
    case "pull_request": {
      const pr = asRecord(body.pull_request);
      return [
        {
          evidenceType: "github_pull_request",
          providerId: `pr:${repository.githubRepositoryId}:${pr.number ?? body.number}`,
          title: stringOrNull(pr.title),
          summary: trimText(stringOrNull(pr.body)),
          branch: stringOrNull(asRecord(pr.head).ref),
          sha: stringOrNull(asRecord(pr.head).sha),
          pullRequestNumber: numberOrNull(pr.number ?? body.number),
          status: pr.merged === true ? "merged" : action ?? stringOrNull(pr.state),
          actorGithubUserId: actor.id,
          actorGithubLogin: actor.login,
          sourceUrl: stringOrNull(pr.html_url),
          occurredAt: dateOrNull(pr.updated_at ?? pr.created_at),
          payload: sanitizePayload({
            action,
            state: pr.state,
            merged: pr.merged,
            draft: pr.draft,
            base: asRecord(pr.base).ref,
            head: asRecord(pr.head).ref
          })
        }
      ];
    }
    case "push": {
      const ref = stringOrNull(body.ref);
      const branch = ref?.replace(/^refs\/heads\//, "") ?? null;
      const items: NormalizedGitHubEvidence[] = [];
      if (branch) {
        items.push({
          evidenceType: "github_branch",
          providerId: `branch:${repository.githubRepositoryId}:${branch}`,
          title: `Branch ${branch}`,
          branch,
          sha: stringOrNull(body.after),
          status: stringOrNull(body.deleted) === "true" ? "deleted" : "updated",
          actorGithubUserId: actor.id,
          actorGithubLogin: actor.login,
          sourceUrl: repository.htmlUrl ? `${repository.htmlUrl}/tree/${encodeURIComponent(branch)}` : null,
          occurredAt: dateOrNull(asRecord(body.head_commit).timestamp),
          payload: sanitizePayload({ ref, before: body.before, after: body.after, forced: body.forced })
        });
      }
      for (const commit of Array.isArray(body.commits) ? body.commits.map(asRecord) : []) {
        const sha = stringOrNull(commit.id);
        if (!sha) continue;
        items.push({
          evidenceType: "github_commit",
          providerId: `commit:${repository.githubRepositoryId}:${sha}`,
          title: trimText(stringOrNull(commit.message), 240),
          branch,
          sha,
          status: "pushed",
          actorGithubUserId: actor.id,
          actorGithubLogin: actor.login,
          sourceUrl: stringOrNull(commit.url),
          occurredAt: dateOrNull(commit.timestamp),
          payload: sanitizePayload({ distinct: commit.distinct })
        });
        for (const filePath of collectCommitPaths(commit)) {
          items.push({
            evidenceType: "github_commit_file",
            providerId: `commit_file:${repository.githubRepositoryId}:${sha}:${hashStable(filePath)}`,
            title: filePath,
            branch,
            sha,
            path: filePath,
            status: "changed",
            actorGithubUserId: actor.id,
            actorGithubLogin: actor.login,
            sourceUrl: stringOrNull(commit.url),
            occurredAt: dateOrNull(commit.timestamp),
            payload: sanitizePayload({ path: filePath })
          });
        }
      }
      return items;
    }
    case "pull_request_review": {
      const review = asRecord(body.review);
      const pr = asRecord(body.pull_request);
      return [
        {
          evidenceType: "github_review",
          providerId: `review:${repository.githubRepositoryId}:${review.id}`,
          title: `PR review ${review.state ?? "submitted"}`,
          summary: trimText(stringOrNull(review.body)),
          branch: stringOrNull(asRecord(pr.head).ref),
          sha: stringOrNull(review.commit_id),
          pullRequestNumber: numberOrNull(pr.number),
          status: stringOrNull(review.state ?? action),
          actorGithubUserId: actor.id,
          actorGithubLogin: actor.login,
          sourceUrl: stringOrNull(review.html_url),
          occurredAt: dateOrNull(review.submitted_at),
          payload: sanitizePayload({ action, state: review.state })
        }
      ];
    }
    case "pull_request_review_comment": {
      const comment = asRecord(body.comment);
      const pr = asRecord(body.pull_request);
      return [
        {
          evidenceType: "github_review_comment",
          providerId: `review_comment:${repository.githubRepositoryId}:${comment.id}`,
          title: trimText(stringOrNull(comment.path), 240),
          summary: trimText(stringOrNull(comment.body)),
          branch: stringOrNull(asRecord(pr.head).ref),
          sha: stringOrNull(comment.commit_id),
          pullRequestNumber: numberOrNull(pr.number),
          path: stringOrNull(comment.path),
          status: action,
          actorGithubUserId: actor.id,
          actorGithubLogin: actor.login,
          sourceUrl: stringOrNull(comment.html_url),
          occurredAt: dateOrNull(comment.updated_at ?? comment.created_at),
          payload: sanitizePayload({ action, position: comment.position, line: comment.line })
        }
      ];
    }
    case "issue_comment": {
      const comment = asRecord(body.comment);
      const issue = asRecord(body.issue);
      return [
        {
          evidenceType: "github_issue_comment",
          providerId: `issue_comment:${repository.githubRepositoryId}:${comment.id}`,
          title: `Issue/PR comment #${issue.number ?? "unknown"}`,
          summary: trimText(stringOrNull(comment.body)),
          pullRequestNumber: issue.pull_request ? numberOrNull(issue.number) : null,
          status: action,
          actorGithubUserId: actor.id,
          actorGithubLogin: actor.login,
          sourceUrl: stringOrNull(comment.html_url),
          occurredAt: dateOrNull(comment.updated_at ?? comment.created_at),
          payload: sanitizePayload({ action, issueNumber: issue.number, isPullRequest: Boolean(issue.pull_request) })
        }
      ];
    }
    case "check_run": {
      const check = asRecord(body.check_run);
      return [
        {
          evidenceType: "github_check_run",
          providerId: `check_run:${repository.githubRepositoryId}:${check.id}`,
          title: stringOrNull(check.name),
          summary: trimText(stringOrNull(check.output ? asRecord(check.output).summary : undefined)),
          branch: stringOrNull(asRecord(check.check_suite).head_branch),
          sha: stringOrNull(check.head_sha),
          status: stringOrNull(check.conclusion ?? check.status ?? action),
          actorGithubUserId: actor.id,
          actorGithubLogin: actor.login,
          sourceUrl: stringOrNull(check.html_url),
          occurredAt: dateOrNull(check.completed_at ?? check.started_at),
          payload: sanitizePayload({ action, status: check.status, conclusion: check.conclusion })
        }
      ];
    }
    case "deployment":
    case "deployment_status": {
      const deployment = asRecord(body.deployment);
      const deploymentStatus = asRecord(body.deployment_status);
      const status = eventType === "deployment_status" ? deploymentStatus.state : deployment.task ?? action;
      return [
        {
          evidenceType: eventType === "deployment_status" ? "github_deployment_status" : "github_deployment",
          providerId: `${eventType}:${repository.githubRepositoryId}:${deploymentStatus.id ?? deployment.id}`,
          title: stringOrNull(deployment.environment) ?? "Deployment",
          summary: trimText(stringOrNull(deploymentStatus.description)),
          branch: stringOrNull(deployment.ref),
          sha: stringOrNull(deployment.sha),
          status: stringOrNull(status),
          actorGithubUserId: actor.id,
          actorGithubLogin: actor.login,
          sourceUrl: stringOrNull(deploymentStatus.target_url ?? deployment.url),
          occurredAt: dateOrNull(deploymentStatus.created_at ?? deployment.created_at),
          payload: sanitizePayload({ action, environment: deployment.environment, state: deploymentStatus.state })
        }
      ];
    }
    default:
      return [];
  }
}

export function sanitizePayload(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value, 0);
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [key, SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeValue(item, depth + 1)])
    );
  }
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) return "[redacted]";
    return trimText(value);
  }
  return value;
}

function normalizeActor(value: unknown) {
  const actor = asRecord(value);
  return {
    id: toOptionalProviderId(actor.id),
    login: stringOrNull(actor.login)
  };
}

function collectCommitPaths(commit: Record<string, unknown>) {
  return ["added", "modified", "removed"].flatMap((key) =>
    Array.isArray(commit[key]) ? (commit[key] as unknown[]).filter((item): item is string => typeof item === "string") : []
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toProviderId(value: unknown) {
  const id = toOptionalProviderId(value);
  return id ?? "unknown";
}

function toOptionalProviderId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function dateOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function trimText(value: string | null, maxLength = MAX_TEXT_LENGTH) {
  if (!value) return null;
  if (SECRET_VALUE_PATTERN.test(value)) return "[redacted]";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated]` : value;
}

function hashStable(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function joinFullName(owner: string | undefined, name: string | undefined) {
  return owner && name ? `${owner}/${name}` : name ?? "unknown/unknown";
}

function splitOwner(fullName: string | undefined) {
  return fullName?.split("/")[0] ?? "unknown";
}

function splitName(fullName: string | undefined) {
  return fullName?.split("/")[1] ?? fullName ?? "unknown";
}
