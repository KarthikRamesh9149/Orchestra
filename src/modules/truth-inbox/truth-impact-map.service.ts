import type { Prisma, PrismaClient } from "@prisma/client";
import type { TruthInboxItem, TruthInboxOpenTarget } from "./truth-inbox.types.js";
import type {
  TruthImpactBrainNode,
  TruthImpactDocumentSection,
  TruthImpactGroup,
  TruthImpactGroupKey,
  TruthImpactItem,
  TruthImpactMap,
  TruthImpactProposal
} from "./truth-impact-map.types.js";

const GROUP_LABELS: Record<TruthImpactGroupKey, string> = {
  product_brain: "Product Brain",
  requirements: "Requirements & constraints",
  live_doc: "Live Doc",
  source_documents: "Source documents",
  previous_decisions: "Previous decisions",
  owners: "Responsible people",
  repositories: "Repositories",
  files_modules: "Files & modules",
  pull_requests: "Pull requests",
  tests: "Tests & checks",
  context_packs: "Agent context packs",
  agent_files: "Agent files",
  client_commitments: "Client commitments"
};

const GROUP_ORDER = Object.keys(GROUP_LABELS) as TruthImpactGroupKey[];
const MAX_ITEMS_PER_GROUP = 12;

type AddImpact = Omit<TruthImpactItem, "id" | "group"> & { id: string; group: TruthImpactGroupKey };

export class TruthImpactMapService {
  constructor(private readonly prisma: PrismaClient) {}

  reviewOnly(): TruthImpactMap {
    return finalizeMap(null, new Map(), "review_only", [
      "A Change Impact Map is produced only after a review signal becomes a persisted change proposal.",
      "No relationship is inferred from title similarity or model output."
    ]);
  }

  async buildForProposal(input: {
    projectId: string;
    item: TruthInboxItem;
    proposal: TruthImpactProposal;
    directNodes: TruthImpactBrainNode[];
    directSections: TruthImpactDocumentSection[];
  }): Promise<TruthImpactMap> {
    const { projectId, item, proposal } = input;
    const buckets = new Map<TruthImpactGroupKey, Map<string, TruthImpactItem>>();
    const add = (impact: AddImpact) => addImpact(buckets, impact);
    const nodeById = new Map(input.directNodes.map((node) => [node.id, node]));
    const sectionById = new Map(input.directSections.map((section) => [section.id, section]));
    const directNodeIds = [...nodeById.keys()];
    const directSectionIds = [...sectionById.keys()];

    const graphWhere: Prisma.BrainSectionLinkWhereInput[] = [];
    if (directNodeIds.length) graphWhere.push({ brainNodeId: { in: directNodeIds } });
    if (directSectionIds.length) graphWhere.push({ documentSectionId: { in: directSectionIds } });

    const [graphLinks, liveDocDrafts] = await Promise.all([
      graphWhere.length ? this.prisma.brainSectionLink.findMany({
        where: { projectId, OR: graphWhere },
        select: {
          relationship: true,
          brainNode: {
            select: {
              id: true,
              artifactVersionId: true,
              nodeType: true,
              title: true,
              summary: true,
              status: true,
              artifactVersion: { select: { artifactType: true, status: true, acceptedAt: true } }
            }
          },
          documentSection: {
            select: {
              id: true,
              documentVersionId: true,
              anchorId: true,
              headingPath: true,
              normalizedText: true,
              pageNumber: true,
              documentVersion: {
                select: {
                  id: true,
                  status: true,
                  document: { select: { id: true, title: true, currentVersionId: true, visibility: true } }
                }
              }
            }
          }
        },
        take: 200
      }) : Promise.resolve([]),
      this.prisma.liveDocSectionDraft.findMany({
        where: { projectId, linkedProposalId: proposal.id },
        select: {
          id: true,
          sectionKey: true,
          sectionLabel: true,
          proposedContent: true,
          status: true,
          artifactVersionId: true,
          documentSectionId: true
        },
        orderBy: { updatedAt: "desc" },
        take: 50
      })
    ]);

    for (const link of graphLinks) {
      if (!nodeById.has(link.brainNode.id)) nodeById.set(link.brainNode.id, link.brainNode);
      if (!sectionById.has(link.documentSection.id)) sectionById.set(link.documentSection.id, link.documentSection);
    }

    const allNodeIds = [...nodeById.keys()];
    const allSectionIds = [...sectionById.keys()];
    const documentIds = unique([...sectionById.values()].map((section) => section.documentVersion.document.id));
    const referenceFilters: Prisma.AgentContextPackSourceWhereInput[] = [
      { sourceRefType: "change_proposal", sourceRefId: proposal.id },
      ...(allNodeIds.length ? [{ sourceRefType: "brain_node", sourceRefId: { in: allNodeIds } }] : []),
      ...(allSectionIds.length ? [{ sourceRefType: "document_section", sourceRefId: { in: allSectionIds } }] : []),
      ...(proposal.decisionRecordId ? [{ sourceRefType: "decision_record", sourceRefId: proposal.decisionRecordId }] : [])
    ];
    const sharedReferenceFilters: Prisma.SpecChangeLinkWhereInput[] = [
      ...(allNodeIds.length ? [{ linkType: "brain_node" as const, linkRefId: { in: allNodeIds } }] : []),
      ...(allSectionIds.length ? [{ linkType: "document_section" as const, linkRefId: { in: allSectionIds } }] : [])
    ];

    const [liveDocSources, priorLinks, matchingPackSources] = await Promise.all([
      documentIds.length ? this.prisma.projectLiveDocSource.findMany({
        where: { projectId, documentId: { in: documentIds } },
        select: { documentId: true, sourceKind: true }
      }) : Promise.resolve([]),
      sharedReferenceFilters.length ? this.prisma.specChangeLink.findMany({
        where: {
          projectId,
          OR: sharedReferenceFilters,
          proposal: { is: { id: { not: proposal.id }, status: "accepted" } }
        },
        select: {
          linkType: true,
          linkRefId: true,
          relationship: true,
          proposal: {
            select: {
              id: true,
              title: true,
              summary: true,
              status: true,
              updatedAt: true,
              decisionRecord: { select: { id: true, title: true, statement: true, status: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 100
      }) : Promise.resolve([]),
      this.prisma.agentContextPackSource.findMany({
        where: {
          projectId,
          OR: referenceFilters,
          pack: { is: { status: "active", deletedAt: null } }
        },
        select: {
          sourceRefType: true,
          sourceRefId: true,
          relationship: true,
          pack: { select: { id: true, title: true, taskType: true, status: true, generatedAt: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 100
      })
    ]);

    const liveDocDocumentIds = new Set(liveDocSources.map((source) => source.documentId));
    const directNodeSet = new Set(directNodeIds);
    const directSectionSet = new Set(directSectionIds);
    for (const node of nodeById.values()) {
      const direct = directNodeSet.has(node.id);
      const relationship = directRelationship(
        direct,
        direct ? "The proposal explicitly links this Product Brain node." : "A persisted Brain-to-section relationship connects this node to an explicitly affected section."
      );
      add({
        id: `brain-node:${node.id}`,
        group: "product_brain",
        label: node.title,
        detail: truncate(node.summary, 240),
        status: `${node.artifactVersion.status} ${node.nodeType}`,
        relationship,
        confidence: direct ? "verified" : "related",
        openTarget: { targetType: "product_brain", targetRef: { brainNodeId: node.id, artifactVersionId: node.artifactVersionId } }
      });
      if (node.nodeType === "constraint") {
        add({
          id: `requirement-node:${node.id}`,
          group: "requirements",
          label: node.title,
          detail: truncate(node.summary, 240),
          status: node.status,
          relationship,
          confidence: direct ? "verified" : "related",
          openTarget: { targetType: "product_brain", targetRef: { brainNodeId: node.id, artifactVersionId: node.artifactVersionId } }
        });
      }
    }

    for (const section of sectionById.values()) {
      const direct = directSectionSet.has(section.id);
      const relationship = directRelationship(
        direct,
        direct ? "The proposal explicitly links this document section." : "A persisted Brain-to-section relationship connects this section to an affected Product Brain node."
      );
      const sectionLabel = section.headingPath.join(" > ") || section.anchorId;
      add({
        id: `document-section:${section.id}`,
        group: "source_documents",
        label: `${section.documentVersion.document.title} · ${sectionLabel}`,
        detail: truncate(section.normalizedText, 240),
        status: section.documentVersion.document.currentVersionId === section.documentVersion.id ? "current version" : "historical version",
        relationship,
        confidence: direct ? "verified" : "related",
        openTarget: documentTarget(section)
      });
      if (liveDocDocumentIds.has(section.documentVersion.document.id)) {
        add({
          id: `live-doc-source:${section.id}`,
          group: "live_doc",
          label: sectionLabel,
          detail: `Live Doc source: ${section.documentVersion.document.title}`,
          status: "persisted source",
          relationship: graphRelationship("This section belongs to the project's persisted Live Doc source."),
          confidence: "verified",
          openTarget: documentTarget(section)
        });
      }
    }

    for (const draft of liveDocDrafts) {
      add({
        id: `live-doc-draft:${draft.id}`,
        group: "live_doc",
        label: draft.sectionLabel,
        detail: truncate(draft.proposedContent, 240),
        status: draft.status,
        relationship: directRelationship(true, "This Live Doc draft is explicitly linked to the proposal."),
        confidence: "verified",
        openTarget: { targetType: "live_doc_section", targetRef: { sectionKey: draft.sectionKey } }
      });
    }

    const previousDecisionIds = new Set<string>();
    if (proposal.decisionRecord) {
      if (proposal.decisionRecord.status === "accepted") previousDecisionIds.add(proposal.decisionRecord.id);
      addDecision(add, proposal.decisionRecord, "The proposal explicitly references this decision record.", "direct_proposal_link");
    }
    for (const link of priorLinks) {
      const decision = link.proposal.decisionRecord;
      if (decision) {
        if (decision.status === "accepted") previousDecisionIds.add(decision.id);
        addDecision(
          add,
          decision,
          decision.status === "accepted"
            ? `This accepted decision shares the affected ${humanize(link.linkType)} reference.`
            : `This persisted decision record belongs to an accepted proposal sharing the affected ${humanize(link.linkType)} reference.`,
          "accepted_shared_reference"
        );
      } else {
        add({
          id: `accepted-proposal:${link.proposal.id}`,
          group: "previous_decisions",
          label: link.proposal.title,
          detail: truncate(link.proposal.summary, 240),
          status: link.proposal.status,
          relationship: sharedRelationship(`This accepted proposal shares the affected ${humanize(link.linkType)} reference.`),
          confidence: "verified",
          openTarget: { targetType: "change_proposal", targetRef: { proposalId: link.proposal.id } }
        });
      }
    }

    if (item.owner) {
      add({
        id: `owner:${item.owner.userId}`,
        group: "owners",
        label: item.owner.displayName,
        detail: item.owner.email,
        status: "assigned",
        relationship: directRelationship(true, "This person is authoritatively assigned to the Truth Inbox item."),
        confidence: "verified",
        openTarget: null
      });
    }

    const packIds = unique(matchingPackSources.map((source) => source.pack.id));
    for (const source of matchingPackSources) {
      add({
        id: `context-pack:${source.pack.id}`,
        group: "context_packs",
        label: source.pack.title,
        detail: `${humanize(source.pack.taskType)} pack generated ${source.pack.generatedAt.toISOString()}`,
        status: source.pack.status,
        relationship: graphRelationship(`The pack contains ${humanize(source.sourceRefType)} as a persisted source (${humanize(source.relationship)}).`),
        confidence: "verified",
        openTarget: null
      });
    }

    const decisionIds = unique([...previousDecisionIds]);
    const companionSourceTypes = ["coding_requirement", "project_context"];
    const brainArtifactIds = unique([...nodeById.values()].map((node) => node.artifactVersionId));
    const liveDocArtifactIds = unique(liveDocDrafts.map((draft) => draft.artifactVersionId).filter((id): id is string => Boolean(id)));
    const agentFileWhere: Prisma.AgentMarkdownFileVersionWhereInput[] = [
      ...(brainArtifactIds.length ? [{ generatedFromProductBrainVersionId: { in: brainArtifactIds } }] : []),
      ...(liveDocArtifactIds.length ? [{ generatedFromLiveDocVersionId: { in: liveDocArtifactIds } }] : []),
      ...packIds.slice(0, 20).map((packId) => ({ contextPackIdsJson: { array_contains: [packId] } }))
    ];

    const [decisionLinks, companionSources, agentFileVersions] = await Promise.all([
      decisionIds.length ? this.prisma.fdeDecisionEngineeringLink.findMany({
        where: { projectId, decisionId: { in: decisionIds }, archivedAt: null },
        select: {
          id: true,
          decisionId: true,
          targetType: true,
          targetRef: true,
          relationshipType: true,
          confidence: true,
          evidenceIdsJson: true,
          openTargetsJson: true
        },
        orderBy: { updatedAt: "desc" },
        take: 100
      }) : Promise.resolve([]),
      packIds.length ? this.prisma.agentContextPackSource.findMany({
        where: { projectId, packId: { in: packIds }, sourceRefType: { in: companionSourceTypes } },
        select: { packId: true, sourceRefType: true, sourceRefId: true, relationship: true },
        orderBy: { createdAt: "desc" },
        take: 100
      }) : Promise.resolve([]),
      agentFileWhere.length ? this.prisma.agentMarkdownFileVersion.findMany({
        where: { projectId, OR: agentFileWhere },
        select: {
          id: true,
          versionNumber: true,
          status: true,
          generatedAt: true,
          file: { select: { id: true, title: true, filePath: true, status: true } },
          fileSet: { select: { name: true, repoOwner: true, repoName: true, targetBranch: true } }
        },
        orderBy: { generatedAt: "desc" },
        take: 100
      }) : Promise.resolve([])
    ]);

    const evidenceIds = unique(decisionLinks.flatMap((link) => asStringArray(link.evidenceIdsJson)));
    const codingRequirementIds = unique(companionSources.filter((source) => source.sourceRefType === "coding_requirement").map((source) => source.sourceRefId));
    const contextEntryIds = unique(companionSources.filter((source) => source.sourceRefType === "project_context").map((source) => source.sourceRefId));
    const [engineeringEvidence, githubEvidence, codingRequirements, contextEntries] = await Promise.all([
      evidenceIds.length ? this.prisma.engineeringEvidenceItem.findMany({
        where: { projectId, id: { in: evidenceIds }, archivedAt: null },
        select: {
          id: true,
          provider: true,
          sourceSubType: true,
          repositoryOwner: true,
          repositoryName: true,
          sha: true,
          pullRequestNumber: true,
          filePath: true,
          status: true,
          title: true,
          summary: true,
          sourceUrl: true
        }
      }) : Promise.resolve([]),
      evidenceIds.length ? this.prisma.gitHubEngineeringEvidence.findMany({
        where: { projectId, id: { in: evidenceIds }, evidenceStatus: "active" },
        select: {
          id: true,
          evidenceType: true,
          repositoryOwner: true,
          repositoryName: true,
          sha: true,
          pullRequestNumber: true,
          path: true,
          status: true,
          title: true,
          summary: true,
          sourceUrl: true
        }
      }) : Promise.resolve([]),
      codingRequirementIds.length ? this.prisma.projectCodingRequirements.findMany({
        where: { projectId, id: { in: codingRequirementIds } },
        select: { id: true, artifactVersion: { select: { versionNumber: true, status: true, payloadJson: true } } }
      }) : Promise.resolve([]),
      contextEntryIds.length ? this.prisma.projectContextEntry.findMany({
        where: { projectId, id: { in: contextEntryIds }, status: "active", deletedAt: null },
        select: { id: true, title: true, body: true, tagsJson: true, importance: true }
      }) : Promise.resolve([])
    ]);

    for (const link of decisionLinks) addDecisionLink(add, link);
    for (const evidence of engineeringEvidence) addEngineeringEvidence(add, {
      id: evidence.id,
      subtype: evidence.sourceSubType,
      repositoryOwner: evidence.repositoryOwner,
      repositoryName: evidence.repositoryName,
      sha: evidence.sha,
      pullRequestNumber: evidence.pullRequestNumber,
      filePath: evidence.filePath,
      status: evidence.status,
      title: evidence.title,
      summary: evidence.summary,
      sourceUrl: evidence.sourceUrl
    });
    for (const evidence of githubEvidence) addEngineeringEvidence(add, {
      id: evidence.id,
      subtype: String(evidence.evidenceType),
      repositoryOwner: evidence.repositoryOwner,
      repositoryName: evidence.repositoryName,
      sha: evidence.sha,
      pullRequestNumber: evidence.pullRequestNumber,
      filePath: evidence.path,
      status: evidence.status,
      title: evidence.title,
      summary: evidence.summary,
      sourceUrl: evidence.sourceUrl
    });

    for (const requirement of codingRequirements) {
      add({
        id: `coding-requirements:${requirement.id}`,
        group: "requirements",
        label: `Engineering requirements v${requirement.artifactVersion.versionNumber}`,
        detail: summarizeJson(requirement.artifactVersion.payloadJson),
        status: requirement.artifactVersion.status,
        relationship: graphRelationship("A mapped context pack contains this coding-requirements source."),
        confidence: "related",
        openTarget: { targetType: "coding_requirements", targetRef: { codingRequirementsId: requirement.id } }
      });
    }

    for (const version of agentFileVersions) {
      add({
        id: `agent-file:${version.file.id}`,
        group: "agent_files",
        label: version.file.filePath,
        detail: `${version.fileSet.name} · v${version.versionNumber} · ${version.fileSet.repoOwner && version.fileSet.repoName ? `${version.fileSet.repoOwner}/${version.fileSet.repoName} · ` : ""}${version.fileSet.targetBranch}`,
        status: version.file.status,
        relationship: graphRelationship("This generated file version records an affected Product Brain, Live Doc, or context-pack version."),
        confidence: "verified",
        openTarget: null
      });
    }

    for (const context of contextEntries) {
      if (!isExplicitClientCommitment(context.tagsJson)) continue;
      add({
        id: `client-commitment:${context.id}`,
        group: "client_commitments",
        label: context.title,
        detail: truncate(context.body, 240),
        status: context.importance,
        relationship: graphRelationship("A mapped context pack includes a project-context record explicitly tagged as a client commitment."),
        confidence: "verified",
        openTarget: { targetType: "project_context", targetRef: { contextId: context.id } }
      });
    }

    const impact = asRecord(proposal.impactSummaryJson);
    const clientExpectationImpact = scalarText(impact.clientExpectationImpact);
    if (clientExpectationImpact) {
      add({
        id: `recorded-client-impact:${proposal.id}`,
        group: "client_commitments",
        label: "Recorded client-expectation impact",
        detail: clientExpectationImpact,
        status: "proposal record",
        relationship: recordedRelationship("This is recorded on the proposal's impact summary; it is not proof of client approval."),
        confidence: "recorded",
        openTarget: { targetType: "change_proposal", targetRef: { proposalId: proposal.id } }
      });
    }

    const limitations = [
      "Only explicit proposal links, persisted graph relationships, accepted shared references, and recorded impact fields are mapped.",
      "Title similarity and unreviewed semantic guesses are deliberately excluded.",
      "An empty group means Orchestra has no persisted relationship for that area; it does not prove there is no impact.",
      "Recorded impact is shown separately from verified linked evidence.",
      `Each area is capped at ${MAX_ITEMS_PER_GROUP} linked records to keep the packet fast and reviewable.`,
      ...(agentFileVersions.length === 100 ? ["Agent-file mapping is limited to the 100 newest matching generated versions."] : []),
      ...(decisionIds.length === 0 ? ["Engineering delivery evidence requires a persisted accepted-decision link; none is available for this proposal."] : [])
    ];
    return finalizeMap(proposal.id, buckets, "partial", limitations);
  }
}

function addImpact(buckets: Map<TruthImpactGroupKey, Map<string, TruthImpactItem>>, impact: AddImpact) {
  const bucket = buckets.get(impact.group) ?? new Map<string, TruthImpactItem>();
  if (!bucket.has(impact.id) && bucket.size < MAX_ITEMS_PER_GROUP) bucket.set(impact.id, impact);
  buckets.set(impact.group, bucket);
}

function finalizeMap(
  proposalId: string | null,
  buckets: Map<TruthImpactGroupKey, Map<string, TruthImpactItem>>,
  requestedStatus: TruthImpactMap["status"],
  limitations: string[]
): TruthImpactMap {
  const groups: TruthImpactGroup[] = GROUP_ORDER.map((key) => {
    const items = [...(buckets.get(key)?.values() ?? [])];
    return { key, label: GROUP_LABELS[key], coverage: requestedStatus === "review_only" ? "not_applicable" : items.length ? "mapped" : "not_recorded", items };
  });
  const allItems = groups.flatMap((group) => group.items);
  const mappedGroups = groups.filter((group) => group.coverage === "mapped").length;
  return {
    proposalId,
    status: requestedStatus === "review_only" ? "review_only" : mappedGroups === groups.length ? "mapped" : "partial",
    groups,
    summary: {
      mappedGroups,
      totalGroups: groups.length,
      mappedItems: allItems.length,
      verifiedItems: allItems.filter((item) => item.confidence === "verified").length,
      recordedItems: allItems.filter((item) => item.confidence === "recorded").length
    },
    generatedAt: new Date().toISOString(),
    limitations: unique(limitations)
  };
}

function addDecision(
  add: (impact: AddImpact) => void,
  decision: { id: string; title: string; statement: string; status: string },
  reason: string,
  relationshipKind: "direct_proposal_link" | "accepted_shared_reference"
) {
  add({
    id: `decision:${decision.id}`,
    group: "previous_decisions",
    label: decision.title,
    detail: truncate(decision.statement, 240),
    status: decision.status,
    relationship: relationshipKind === "direct_proposal_link" ? directRelationship(true, reason) : sharedRelationship(reason),
    confidence: "verified",
    openTarget: { targetType: "decision_record", targetRef: { decisionRecordId: decision.id } }
  });
}

function addDecisionLink(
  add: (impact: AddImpact) => void,
  link: {
    id: string;
    targetType: string;
    targetRef: string;
    relationshipType: string;
    confidence: string;
    openTargetsJson: unknown;
  }
) {
  const group = groupForEngineeringTarget(link.targetType, link.targetRef);
  if (!group) return;
  add({
    id: `decision-link:${link.id}`,
    group,
    label: link.targetRef,
    detail: `Decision-to-engineering link: ${humanize(link.relationshipType)}`,
    status: link.confidence,
    relationship: graphRelationship("An accepted decision has a persisted engineering relationship to this target."),
    confidence: link.confidence === "exact_link" || link.confidence === "manual_linked" ? "verified" : "related",
    openTarget: firstOpenTarget(link.openTargetsJson)
  });
}

function addEngineeringEvidence(
  add: (impact: AddImpact) => void,
  evidence: {
    id: string;
    subtype: string;
    repositoryOwner: string | null;
    repositoryName: string | null;
    sha: string | null;
    pullRequestNumber: number | null;
    filePath: string | null;
    status: string | null;
    title: string | null;
    summary: string | null;
    sourceUrl: string | null;
  }
) {
  const repo = evidence.repositoryOwner && evidence.repositoryName ? `${evidence.repositoryOwner}/${evidence.repositoryName}` : null;
  const target: TruthInboxOpenTarget | null = repo
    ? { targetType: "github_evidence", targetRef: { evidenceId: evidence.id, repo, ...(evidence.sha ? { sha: evidence.sha } : {}), ...(evidence.sourceUrl ? { sourceUrl: evidence.sourceUrl } : {}) } }
    : null;
  const reason = "This engineering record is cited by a persisted decision-to-engineering link.";
  if (repo) add({
    id: `repository:${repo}`,
    group: "repositories",
    label: repo,
    detail: evidence.summary ?? evidence.title ?? humanize(evidence.subtype),
    status: evidence.status,
    relationship: graphRelationship(reason),
    confidence: "verified",
    openTarget: target
  });
  if (evidence.filePath) add({
    id: `file:${repo ?? "unknown"}:${evidence.filePath}`,
    group: "files_modules",
    label: evidence.filePath,
    detail: evidence.title ?? evidence.summary ?? humanize(evidence.subtype),
    status: evidence.status,
    relationship: graphRelationship(reason),
    confidence: "verified",
    openTarget: target
  });
  if (evidence.pullRequestNumber != null) add({
    id: `pull-request:${repo ?? "unknown"}:${evidence.pullRequestNumber}`,
    group: "pull_requests",
    label: `${repo ?? "Repository"} #${evidence.pullRequestNumber}`,
    detail: evidence.title ?? evidence.summary ?? "Linked pull request evidence",
    status: evidence.status,
    relationship: graphRelationship(reason),
    confidence: "verified",
    openTarget: target
  });
  if (isTestEvidence(evidence.subtype, evidence.filePath)) add({
    id: `test:${evidence.id}`,
    group: "tests",
    label: evidence.filePath ?? evidence.title ?? humanize(evidence.subtype),
    detail: evidence.summary ?? "Linked test or check evidence",
    status: evidence.status,
    relationship: graphRelationship(reason),
    confidence: "verified",
    openTarget: target
  });
}

function groupForEngineeringTarget(targetType: string, targetRef: string): TruthImpactGroupKey | null {
  if (targetType === "pull_request") return "pull_requests";
  if (["file", "module", "route", "branch", "manual"].includes(targetType)) return isTestEvidence(targetType, targetRef) ? "tests" : "files_modules";
  if (targetType === "product_brain_node") return "product_brain";
  if (targetType === "live_doc_section") return "live_doc";
  if (targetType === "document_section") return "source_documents";
  return null;
}

function directRelationship(direct: boolean, reason: string): TruthImpactItem["relationship"] {
  return direct
    ? { kind: "direct_proposal_link", label: "Direct proposal link", reason }
    : { kind: "persisted_graph_link", label: "Persisted graph link", reason };
}

function graphRelationship(reason: string): TruthImpactItem["relationship"] {
  return { kind: "persisted_graph_link", label: "Persisted graph link", reason };
}

function sharedRelationship(reason: string): TruthImpactItem["relationship"] {
  return { kind: "accepted_shared_reference", label: "Accepted shared reference", reason };
}

function recordedRelationship(reason: string): TruthImpactItem["relationship"] {
  return { kind: "recorded_impact", label: "Recorded impact", reason };
}

function documentTarget(section: TruthImpactDocumentSection): TruthInboxOpenTarget {
  return {
    targetType: "document_section",
    targetRef: {
      documentId: section.documentVersion.document.id,
      anchorId: section.anchorId,
      ...(section.pageNumber == null ? {} : { pageNumber: section.pageNumber })
    }
  };
}

function firstOpenTarget(value: unknown): TruthInboxOpenTarget | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record.targetType !== "string" || !record.targetRef || typeof record.targetRef !== "object" || Array.isArray(record.targetRef)) return null;
  return { targetType: record.targetType, targetRef: record.targetRef as Record<string, unknown> };
}

function isExplicitClientCommitment(value: unknown) {
  const tags = asStringArray(value).map((tag) => tag.toLowerCase().replace(/\s+/g, "_"));
  return tags.some((tag) => ["client_commitment", "client-approved", "client_approved"].includes(tag));
}

function isTestEvidence(subtype: string, path: string | null) {
  return /(^|[_-])(test|check|workflow)([_-]|$)/i.test(subtype) || Boolean(path && /(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\.[^.]+$/i.test(path));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
}

function scalarText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function summarizeJson(value: unknown) {
  if (typeof value === "string") return truncate(value, 240);
  if (!value || typeof value !== "object") return "Persisted requirements artifact";
  const parts = Object.entries(value as Record<string, unknown>)
    .slice(0, 4)
    .map(([key, entry]) => `${humanize(key)}: ${typeof entry === "string" ? entry : JSON.stringify(entry)}`);
  return truncate(parts.join(" · ") || "Persisted requirements artifact", 240);
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function truncate(value: string, max: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
