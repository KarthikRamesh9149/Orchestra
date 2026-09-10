import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { TruthInboxService } from "./truth-inbox.service.js";
import type { TruthInboxEvidence, TruthInboxItem, TruthInboxOpenTarget } from "./truth-inbox.types.js";
import type { TruthChangePacket, TruthPacketReference } from "./truth-change-packet.types.js";
import type { TruthImpactMapService } from "./truth-impact-map.service.js";

type Actor = { userId: string; orgId: string };
type Proposal = Prisma.SpecChangeProposalGetPayload<{ include: { links: true; decisionRecord: true } }>;

export class TruthChangePacketService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly truthInboxService: TruthInboxService,
    private readonly truthImpactMapService: TruthImpactMapService
  ) {}

  async get(projectId: string, itemId: string, actor: Actor): Promise<TruthChangePacket> {
    const item = await this.truthInboxService.get(projectId, itemId, actor);
    if (item.sourceType !== "proposal") return this.reviewSignalPacket(projectId, item);

    const proposal = await this.prisma.specChangeProposal.findFirst({
      where: { id: item.sourceId, projectId },
      include: { links: true, decisionRecord: true }
    });
    if (!proposal) throw new AppError(404, "Truth Change Packet source proposal not found", "truth_change_packet_source_not_found");

    return this.proposalPacket(projectId, item, proposal);
  }

  private async proposalPacket(projectId: string, item: TruthInboxItem, proposal: Proposal): Promise<TruthChangePacket> {
    const ids = (type: string) => Array.from(new Set(proposal.links.filter((link) => link.linkType === type).map((link) => link.linkRefId)));
    const messageIds = ids("message");
    const threadIds = ids("thread");
    const sectionIds = ids("document_section");
    const nodeIds = ids("brain_node");
    const [messages, threads, sections, nodes] = await Promise.all([
      messageIds.length ? this.prisma.communicationMessage.findMany({
        where: { projectId, id: { in: messageIds }, isDeletedByProvider: false },
        select: {
          id: true,
          provider: true,
          providerPermalink: true,
          senderLabel: true,
          sentAt: true,
          bodyText: true,
          threadId: true,
          thread: { select: { subject: true } }
        }
      }) : Promise.resolve([]),
      threadIds.length ? this.prisma.communicationThread.findMany({
        where: { projectId, id: { in: threadIds } },
        select: { id: true, provider: true, subject: true, threadUrl: true, lastMessageAt: true }
      }) : Promise.resolve([]),
      sectionIds.length ? this.prisma.documentSection.findMany({
        where: { projectId, id: { in: sectionIds } },
        select: {
          id: true,
          documentVersionId: true,
          anchorId: true,
          headingPath: true,
          normalizedText: true,
          pageNumber: true,
          documentVersion: { select: { id: true, status: true, document: { select: { id: true, title: true, currentVersionId: true, visibility: true } } } }
        }
      }) : Promise.resolve([]),
      nodeIds.length ? this.prisma.brainNode.findMany({
        where: { projectId, id: { in: nodeIds } },
        select: {
          id: true,
          nodeType: true,
          title: true,
          summary: true,
          status: true,
          artifactVersionId: true,
          artifactVersion: { select: { artifactType: true, status: true, acceptedAt: true } }
        }
      }) : Promise.resolve([])
    ]);

    const messageById = new Map(messages.map((row) => [row.id, row]));
    const threadById = new Map(threads.map((row) => [row.id, row]));
    const sectionById = new Map(sections.map((row) => [row.id, row]));
    const nodeById = new Map(nodes.map((row) => [row.id, row]));
    const missingEvidence: string[] = [];
    const newEvidence: TruthInboxEvidence[] = [];

    for (const link of proposal.links) {
      if (link.linkType === "message") {
        const row = messageById.get(link.linkRefId);
        if (!row) { missingEvidence.push("A linked source message is unavailable."); continue; }
        newEvidence.push({
          id: `message:${row.id}`,
          source: String(row.provider),
          label: `${row.thread.subject ?? "Communication"} · ${row.senderLabel}`,
          excerpt: truncate(row.bodyText, 600),
          occurredAt: row.sentAt.toISOString(),
          openTarget: { targetType: "message", targetRef: { messageId: row.id, threadId: row.threadId, providerPermalink: row.providerPermalink } }
        });
      } else if (link.linkType === "thread") {
        const row = threadById.get(link.linkRefId);
        if (!row) { missingEvidence.push("A linked source thread is unavailable."); continue; }
        newEvidence.push({
          id: `thread:${row.id}`,
          source: String(row.provider),
          label: row.subject ?? "Communication thread",
          excerpt: "Linked source conversation for this proposed change.",
          occurredAt: row.lastMessageAt?.toISOString() ?? null,
          openTarget: { targetType: "thread", targetRef: { threadId: row.id, providerUrl: row.threadUrl } }
        });
      }
    }
    for (const [index, ref] of asStringArray(proposal.externalEvidenceRefsJson).entries()) {
      newEvidence.push({
        id: `external:${index}`,
        source: "external_evidence",
        label: `External evidence ${index + 1}`,
        excerpt: truncate(ref, 600),
        occurredAt: null,
        openTarget: null
      });
    }

    const affectedProductAreas: TruthPacketReference[] = [];
    for (const sectionId of sectionIds) {
      const section = sectionById.get(sectionId);
      if (!section) continue;
      const current = section.documentVersion.document.currentVersionId === section.documentVersion.id;
      affectedProductAreas.push({
        id: section.id,
        type: "document_section",
        label: `${section.documentVersion.document.title} · ${section.headingPath.join(" > ") || section.anchorId}`,
        detail: truncate(section.normalizedText, 360),
        status: current ? "current_document_version" : "historical_document_version",
        authority: "affected_reference",
        openTarget: documentTarget(section.documentVersion.document.id, section.anchorId, section.pageNumber)
      });
    }
    for (const nodeId of nodeIds) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      const accepted = node.artifactVersion.status === "accepted" && ["brain_graph", "product_brain"].includes(String(node.artifactVersion.artifactType));
      affectedProductAreas.push({
        id: node.id,
        type: "brain_node",
        label: node.title,
        detail: node.summary,
        status: accepted ? `accepted_${node.nodeType}` : `unaccepted_${node.nodeType}`,
        authority: accepted ? "accepted_truth" : "affected_reference",
        openTarget: null
      });
    }

    const currentAcceptedTruth = affectedProductAreas.filter((reference) => reference.authority === "accepted_truth");
    if (proposal.decisionRecord?.status === "accepted") {
      currentAcceptedTruth.push({
        id: proposal.decisionRecord.id,
        type: "accepted_decision",
        label: proposal.decisionRecord.title,
        detail: proposal.decisionRecord.statement,
        status: "accepted",
        authority: "accepted_truth",
        openTarget: null
      });
    }

    const prior = summarizeStructured(proposal.oldUnderstandingJson);
    const proposed = summarizeStructured(proposal.newUnderstandingJson);
    const impact = asRecord(proposal.impactSummaryJson);
    const blockers = unique([
      ...(newEvidence.length === 0 ? ["No available source evidence is linked to this proposed change."] : []),
      ...(currentAcceptedTruth.length === 0 ? ["No linked accepted Product Brain node or accepted decision was resolved."] : []),
      ...missingEvidence,
      ...item.limitations
    ]);
    const canDecide = proposal.status === "detected" || proposal.status === "needs_review";
    const options = decisionOptions(item, blockers.length === 0);
    const confidence = confidenceOf(item.confidence, [
      `${newEvidence.length} available source evidence record${newEvidence.length === 1 ? "" : "s"}`,
      `${currentAcceptedTruth.length} linked accepted-truth record${currentAcceptedTruth.length === 1 ? "" : "s"}`,
      ...(missingEvidence.length ? [`${missingEvidence.length} linked source record${missingEvidence.length === 1 ? " is" : "s are"} unavailable`] : [])
    ]);
    const engineering = unique([
      textImpact(impact, "engineeringImpact", "Engineering impact"),
      textImpact(impact, "scopeImpact", "Scope impact"),
      textImpact(impact, "clientExpectationImpact", "Client expectation impact"),
      stringValue(impact.summary)
    ].filter((value): value is string => Boolean(value)));
    const potentialConflict = {
      summary: prior.length && proposed.length
        ? "The recorded prior understanding and the proposed understanding differ and require an explicit human decision."
        : proposal.proposalType === "contradiction_resolution"
          ? "The proposal records a potential contradiction that requires human resolution."
          : "The new evidence may change current project scope or decisions; this remains an interpretation until reviewed.",
      basis: unique([
        ...(prior.length ? ["A prior understanding is recorded on the proposal."] : []),
        ...(proposed.length ? ["A different proposed understanding is recorded on the proposal."] : []),
        `${newEvidence.length} source evidence record${newEvidence.length === 1 ? " is" : "s are"} linked.`,
        `${affectedProductAreas.length} affected product reference${affectedProductAreas.length === 1 ? " is" : "s are"} linked.`
      ]),
      interpretationOnly: true as const
    };
    const impactMap = await this.truthImpactMapService.buildForProposal({
      projectId,
      item,
      proposal,
      directNodes: nodes,
      directSections: sections
    });

    return {
      id: `packet:${proposal.id}`,
      projectId,
      item,
      packetKind: "proposed_change",
      readiness: canDecide ? (options.includes("accept") ? "decision_ready" : "needs_context") : "review_only",
      newEvidence,
      currentAcceptedTruth,
      recordedPriorUnderstanding: prior,
      proposedChange: {
        proposalId: proposal.id,
        proposalType: proposal.proposalType,
        status: proposal.status,
        title: proposal.title,
        summary: proposal.summary,
        statements: proposed
      },
      potentialConflict,
      affected: {
        productAreas: affectedProductAreas,
        engineering,
        owners: item.owner ? [{ ...item.owner, source: "truth_inbox_assignment" }] : []
      },
      impactMap,
      confidence,
      decision: { required: canDecide, options, blockers },
      boundaries: boundaryStates(newEvidence.length, true, currentAcceptedTruth.length, proposal.status),
      generatedAt: new Date().toISOString(),
      limitations: unique([
        "Evidence, interpretation, proposed change, and accepted truth are separate records.",
        "Opening this packet never updates Product Brain or LiveDoc.",
        "Affected repositories, files, pull requests, tests, and client commitments are added by the Change Impact Map, not inferred here.",
        ...(item.owner ? [] : ["No affected owner is inferred because this Inbox item has not been assigned."]),
        ...blockers
      ])
    };
  }

  private reviewSignalPacket(projectId: string, item: TruthInboxItem): TruthChangePacket {
    const blockers = unique([
      "This Inbox signal is not yet a change proposal. Create a review item before any truth decision.",
      ...(item.evidence.length === 0 ? ["No directly openable source evidence is stored for this signal."] : []),
      ...item.limitations
    ]);
    return {
      id: `packet:${item.id}`,
      projectId,
      item,
      packetKind: "review_signal",
      readiness: "review_only",
      newEvidence: item.evidence,
      currentAcceptedTruth: [],
      recordedPriorUnderstanding: [],
      proposedChange: null,
      potentialConflict: item.category === "decision_conflicts" || item.category === "spec_drift"
        ? { summary: item.description, basis: ["This is a review signal from the authoritative Truth Inbox aggregate."], interpretationOnly: true }
        : null,
      affected: {
        productAreas: [],
        engineering: item.sourceType === "fde" || item.sourceType === "agent_drift" ? [item.description] : [],
        owners: item.owner ? [{ ...item.owner, source: "truth_inbox_assignment" }] : []
      },
      impactMap: this.truthImpactMapService.reviewOnly(),
      confidence: confidenceOf(item.confidence, [`${item.evidence.length} evidence record${item.evidence.length === 1 ? "" : "s"} attached to this signal`]),
      decision: { required: false, options: decisionOptions(item, false), blockers },
      boundaries: boundaryStates(item.evidence.length, false, 0),
      generatedAt: new Date().toISOString(),
      limitations: unique([
        "This packet is review-only and cannot be accepted as truth.",
        "Create Review Item produces a needs-review proposal; it never auto-accepts truth.",
        ...blockers
      ])
    };
  }
}

function decisionOptions(item: TruthInboxItem, acceptReady: boolean): TruthChangePacket["decision"]["options"] {
  const options: TruthChangePacket["decision"]["options"] = [];
  if (acceptReady && item.capabilities.accept) options.push("accept");
  if (item.capabilities.reject) options.push("reject");
  if (item.capabilities.request_clarification) options.push("request_clarification");
  if (item.capabilities.defer) options.push("defer");
  return options;
}

export function boundaryStates(evidenceCount: number, proposed: boolean, acceptedCount: number, proposalStatus = "proposed"): TruthChangePacket["boundaries"] {
  const decided = ["accepted", "rejected", "superseded"].includes(proposalStatus);
  return [
    { stage: "evidence", state: evidenceCount ? "present" : "missing", label: "Evidence", detail: evidenceCount ? `${evidenceCount} source record${evidenceCount === 1 ? "" : "s"}` : "No available source record" },
    { stage: "interpretation", state: evidenceCount ? "present" : "missing", label: "Interpretation", detail: "Machine or workflow interpretation; never truth by itself" },
    { stage: "proposed_change", state: proposed ? decided ? "present" : "pending" : "missing", label: "Proposed change", detail: !proposed ? "No change proposal exists yet" : decided ? `Recorded proposal state: ${proposalStatus}. Opening this packet does not change that decision.` : "Awaiting an authorized human decision" },
    { stage: "accepted_truth", state: "unchanged", label: "Accepted truth", detail: acceptedCount ? `${acceptedCount} linked accepted record${acceptedCount === 1 ? "" : "s"}; unchanged by opening this packet` : "No accepted truth changed" }
  ];
}

function confidenceOf(score: number, basis: string[]): TruthChangePacket["confidence"] {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
  return { score: clamped, label: clamped >= 0.8 ? "high" : clamped >= 0.55 ? "medium" : "low", basis };
}

function summarizeStructured(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return unique(value.flatMap((entry) => summarizeStructured(entry))).slice(0, 12);
  if (typeof value !== "object") return [String(value)];
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry == null || entry === "") continue;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") lines.push(`${humanize(key)}: ${String(entry)}`);
    else if (Array.isArray(entry)) {
      for (const child of entry.slice(0, 6)) {
        const summary = summarizeStructured(child).join(" · ");
        if (summary) lines.push(`${humanize(key)}: ${summary}`);
      }
    } else if (typeof entry === "object") {
      const summary = summarizeStructured(entry).join(" · ");
      if (summary) lines.push(`${humanize(key)}: ${summary}`);
    }
    if (lines.length >= 12) break;
  }
  return unique(lines).slice(0, 12);
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textImpact(record: Record<string, unknown>, key: string, label: string) {
  const value = stringValue(record[key]);
  return value ? `${label}: ${value}` : null;
}

function documentTarget(documentId: string, anchorId: string, pageNumber: number | null): TruthInboxOpenTarget {
  return { targetType: "document_section", targetRef: { documentId, anchorId, ...(pageNumber == null ? {} : { pageNumber }) } };
}

function truncate(value: string, max: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
