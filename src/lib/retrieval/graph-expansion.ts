import type { PrismaClient } from "@prisma/client";
import type { RetrievalCandidate, RetrievalPlan } from "./types.js";
import { lexicalScore } from "./lexical.js";

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function graphAllowed(plan: RetrievalPlan): boolean {
  return (
    !plan.roleSafety.isClientSafe &&
    (plan.requiresBrainGraph ||
      plan.primaryDomains.includes("brain_nodes") ||
      plan.supportingDomains.includes("brain_nodes"))
  );
}

export async function expandBrainGraph(
  prisma: PrismaClient,
  projectId: string,
  plan: RetrievalPlan,
  queryTokens: string[],
  acceptedTruthBoost: number
): Promise<RetrievalCandidate[]> {
  if (!graphAllowed(plan)) return [];
  const query = queryTokens.join(" ");

  const graphArtifact = await prisma.artifactVersion.findFirst({
    where: { projectId, artifactType: "brain_graph", status: "accepted" },
    orderBy: { versionNumber: "desc" },
  });
  if (!graphArtifact) return [];

  const selectedNodeId = plan.selectedRef?.type === "brain_node" ? plan.selectedRef.id : undefined;

  const edges = selectedNodeId
    ? await prisma.brainEdge.findMany({
        where: {
          projectId,
          artifactVersionId: graphArtifact.id,
          OR: [{ fromNodeId: selectedNodeId }, { toNodeId: selectedNodeId }],
        },
        take: 24,
      })
    : [];

  const nodeIds = new Set<string>();
  if (selectedNodeId) nodeIds.add(selectedNodeId);
  for (const edge of edges) {
    nodeIds.add(edge.fromNodeId);
    nodeIds.add(edge.toNodeId);
  }

  const broadGraph = !selectedNodeId && (plan.pageContext === "brain_overview" || plan.intent === "current_truth");
  const nodes = await prisma.brainNode.findMany({
    where: {
      projectId,
      artifactVersionId: graphArtifact.id,
      ...(nodeIds.size > 0 ? { id: { in: Array.from(nodeIds) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: broadGraph ? 16 : 12,
  });

  if (nodes.length === 0) return [];

  const links = await prisma.brainSectionLink.findMany({
    where: {
      projectId,
      artifactVersionId: graphArtifact.id,
      brainNodeId: { in: nodes.map((node) => node.id) },
    },
    include: {
      documentSection: {
        include: {
          documentVersion: {
            include: { document: true },
          },
        },
      },
    },
  });

  const linksByNodeId = new Map<string, typeof links>();
  for (const link of links) {
    const bucket = linksByNodeId.get(link.brainNodeId) ?? [];
    bucket.push(link);
    linksByNodeId.set(link.brainNodeId, bucket);
  }

  const acceptedChangeLinks = await prisma.specChangeLink.findMany({
    where: {
      projectId,
      linkType: "brain_node",
      linkRefId: { in: nodes.map((node) => node.id) },
      proposal: { status: "accepted" },
    },
    include: { proposal: true },
    take: 24,
  });

  const changesByNodeId = new Map<string, typeof acceptedChangeLinks>();
  for (const link of acceptedChangeLinks) {
    const bucket = changesByNodeId.get(link.linkRefId) ?? [];
    bucket.push(link);
    changesByNodeId.set(link.linkRefId, bucket);
  }

  const proposalIds = dedupe(acceptedChangeLinks.map((link) => link.specChangeProposalId));
  const messageLinks = proposalIds.length
    ? await prisma.specChangeLink.findMany({
        where: {
          projectId,
          specChangeProposalId: { in: proposalIds },
          linkType: "message",
        },
        take: 24,
      })
    : [];

  const messagesByProposalId = new Map<string, string[]>();
  for (const link of messageLinks) {
    const bucket = messagesByProposalId.get(link.specChangeProposalId) ?? [];
    bucket.push(link.linkRefId);
    messagesByProposalId.set(link.specChangeProposalId, bucket);
  }

  return nodes.map((node) => {
    const nodeLinks = linksByNodeId.get(node.id) ?? [];
    const changeLinks = changesByNodeId.get(node.id) ?? [];
    const linkedChangeProposalIds = dedupe(changeLinks.map((link) => link.specChangeProposalId));
    const linkedMessageIds = dedupe(
      linkedChangeProposalIds.flatMap((proposalId) => messagesByProposalId.get(proposalId) ?? [])
    );
    const linkedSectionIds = dedupe(nodeLinks.map((link) => link.documentSectionId));
    const decisionRecordIds = dedupe(
      changeLinks
        .map((link) => link.proposal.decisionRecordId)
        .filter((value): value is string => Boolean(value))
    );
    const content = `${node.title}: ${node.summary}`;
    const lex = lexicalScore(query, content);
    const isSelected = selectedNodeId === node.id;
    const isNeighbor = Boolean(selectedNodeId && node.id !== selectedNodeId && nodeIds.has(node.id));
    const edge = edges.find((candidate) => candidate.fromNodeId === node.id || candidate.toNodeId === node.id);

    return {
      id: node.id,
      sourceType: "brain_node" as const,
      domain: "brain_nodes" as const,
      content,
      label: node.title,
      containerId: graphArtifact.id,
      artifactVersionId: graphArtifact.id,
      brainNodeId: node.id,
      brainEdgeId: edge?.id,
      linkedSectionIds,
      linkedMessageIds,
      linkedChangeProposalIds,
      decisionRecordIds,
      sourcePrecedence: "brain_graph" as const,
      evidenceRole: "accepted_truth" as const,
      evidenceCompleteness:
        linkedSectionIds.length + linkedMessageIds.length + linkedChangeProposalIds.length + decisionRecordIds.length > 0
          ? "partial" as const
          : "missing" as const,
      openTarget: {
        targetType: "brain_node",
        targetRef: { nodeId: node.id, artifactVersionId: graphArtifact.id },
      },
      isGraphNeighbor: isNeighbor,
      lexicalScore: lex,
      graphScore: isSelected ? 1 : isNeighbor ? 0.75 : 0.5,
      citationRef: { type: "brain_node", id: node.id, label: node.title },
      citationAvailabilityScore: 1,
      retrievalStage: "graph" as const,
      whySelected: isSelected ? "selected brain node" : isNeighbor ? "direct graph neighbor" : "accepted brain graph node",
      finalScore: (isSelected ? 1.4 : isNeighbor ? 0.9 : 0.5 + lex) * acceptedTruthBoost,
      isClientSafe: false,
      isInternalOnly: true,
    };
  });
}
