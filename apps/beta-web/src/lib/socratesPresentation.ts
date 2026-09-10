import type { Citation, OpenTarget } from "../store/chatStore";

export interface ResolvedOpenTarget {
  href: string;
  label: string;
  external: boolean;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function internalUrl(path: string, params: Record<string, string | null | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return `${path}${search.size ? `?${search.toString()}` : ""}`;
}

export function safeExternalUrl(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function safeMarkdownUrl(value: string) {
  if (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\u0000-\u001f\u007f]/.test(value) &&
    !/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
  ) {
    try {
      const trustedOrigin = "https://beta.orchestraos.dev";
      const parsed = new URL(value, trustedOrigin);
      if (parsed.origin !== trustedOrigin) return null;
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  return safeExternalUrl(value);
}

export function resolveOpenTarget(target: OpenTarget | undefined): ResolvedOpenTarget | null {
  if (!target) return null;
  const ref = target.targetRef ?? {};
  const targetType = target.targetType;
  const id = (key: string) => stringValue(ref[key]);

  if (targetType === "document_section" && id("documentId")) {
    return {
      href: internalUrl(`/memory/docs/${encodeURIComponent(id("documentId")!)}/view`, {
        anchor: id("anchorId"),
        page: typeof ref.pageNumber === "number" ? String(ref.pageNumber) : null,
      }),
      label: "Open document",
      external: false,
    };
  }
  if (targetType === "google_drive_file" && id("driveFileId")) {
    return { href: internalUrl("/memory", { source: "google_drive", file: id("driveFileId") }), label: "Open Drive source", external: false };
  }
  if (targetType === "message") {
    const permalink = safeExternalUrl(ref.providerPermalink);
    if (permalink) return { href: permalink, label: "Open provider message", external: true };
    if (id("messageId")) {
      return { href: internalUrl("/memory", { thread: id("threadId"), message: id("messageId") }), label: "Open message", external: false };
    }
  }
  if (targetType === "thread" && id("threadId")) {
    return { href: internalUrl("/memory", { thread: id("threadId") }), label: "Open thread", external: false };
  }
  if (targetType === "project_event" && id("eventId")) {
    return { href: internalUrl("/memory", { panel: "timeline", event: id("eventId") }), label: "Open timeline event", external: false };
  }
  if (targetType === "change_proposal" && id("proposalId")) {
    return { href: internalUrl("/dashboard", { review: id("proposalId") }), label: "Open review item", external: false };
  }
  if (targetType === "product_brain" && (id("brainNodeId") || id("artifactVersionId"))) {
    return { href: internalUrl("/dashboard", { brainNode: id("brainNodeId"), brainVersion: id("artifactVersionId") }), label: "Open Product Brain", external: false };
  }
  if (targetType === "decision_record" && id("decisionRecordId")) {
    return { href: internalUrl("/memory", { panel: "timeline", decision: id("decisionRecordId") }), label: "Open decision", external: false };
  }
  if (targetType === "live_doc_section" && id("sectionKey")) {
    return { href: internalUrl("/memory", { section: id("sectionKey") }), label: "Open LiveDoc section", external: false };
  }
  if (targetType === "dashboard_filter" && id("filter")) {
    return { href: internalUrl("/dashboard", { filter: id("filter"), value: id("value") }), label: "Open dashboard", external: false };
  }
  if (targetType === "project_responsibility" && id("responsibilityId")) {
    return { href: internalUrl("/dashboard", { responsibility: id("responsibilityId") }), label: "Open responsibility", external: false };
  }
  if (targetType === "project_context" && id("contextId")) {
    return { href: internalUrl("/dashboard", { context: id("contextId") }), label: "Open project context", external: false };
  }
  if (targetType === "project_diagram" && id("diagramId")) {
    return { href: internalUrl("/dashboard", { diagram: id("diagramId") }), label: "Open diagram", external: false };
  }
  if (targetType === "coding_requirements" && id("codingRequirementsId")) {
    return { href: internalUrl("/dashboard", { codingRequirements: id("codingRequirementsId") }), label: "Open requirements", external: false };
  }
  if (targetType === "project_subscription" && id("subscriptionId")) {
    return { href: internalUrl("/dashboard", { subscription: id("subscriptionId") }), label: "Open subscription", external: false };
  }
  if (targetType === "vscode_activity" && id("connectorId")) {
    return { href: internalUrl("/settings", { section: "integrations", connector: id("connectorId") }), label: "Open VS Code connection", external: false };
  }
  if (targetType === "socrates_message" && id("sessionId")) {
    return { href: internalUrl(`/chat/${encodeURIComponent(id("sessionId")!)}`, { message: id("messageId") }), label: "Open prior conversation", external: false };
  }
  if (targetType === "github_evidence") {
    const sourceUrl = safeExternalUrl(ref.sourceUrl);
    if (sourceUrl) return { href: sourceUrl, label: "Open GitHub evidence", external: true };
    const repo = id("repo");
    const sha = id("sha");
    if (repo && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      const href = sha && /^[A-Fa-f0-9]{7,64}$/.test(sha)
        ? `https://github.com/${repo}/commit/${sha}`
        : `https://github.com/${repo}`;
      return { href, label: "Open GitHub evidence", external: true };
    }
    if (id("evidenceId")) {
      return { href: internalUrl("/dashboard", { githubEvidence: id("evidenceId") }), label: "Open GitHub evidence", external: false };
    }
  }
  return null;
}

export function targetForCitation(citation: Citation, targets: OpenTarget[]) {
  if (citation.openTargetId) {
    const exact = targets.find((target) => target.id === citation.openTargetId);
    if (exact) return exact;
  }
  const sameSource = targets.filter((target) => target.sourceType === citation.sourceType);
  return sameSource.length === 1 ? sameSource[0] : undefined;
}
