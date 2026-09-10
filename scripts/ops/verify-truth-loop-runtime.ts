import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/password.js";

type Envelope = { data?: unknown; error?: { code?: string; message?: string } | null };
const prisma = new PrismaClient();

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("API returned an invalid object");
  return value as Record<string, unknown>;
}

async function request(baseUrl: string, path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new Error(`${init.method ?? "GET"} ${path} failed before response: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = (await response.json()) as Envelope;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status} (${body.error?.code ?? "unknown_error"})`);
  return body.data;
}

async function main() {
  const baseUrl = (process.env.BETA_SMOKE_BASE_URL ?? process.env.SMOKE_BASE_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://") || !/staging/i.test(baseUrl)) throw new Error("truth-loop proof requires an isolated HTTPS staging URL");
  const nonce = randomUUID();
  const email = `fix32-truth-${nonce}@example.com`;
  const password = `Fix32Truth-${nonce}-Strong!`;

  const organization = await prisma.organization.create({ data: { name: "Fix 32 Truth Loop", slug: `fix32-truth-${nonce}` } });
  const user = await prisma.user.create({
    data: {
      orgId: organization.id,
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword(password, 4),
      displayName: "Fix 32 Truth Approver",
      globalRole: "owner",
      workspaceRoleDefault: "manager"
    }
  });
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: { globalRole: "owner", workspaceRoleDefault: "manager", isActive: true },
    create: { organizationId: organization.id, userId: user.id, globalRole: "owner", workspaceRoleDefault: "manager" }
  });
  const project = await prisma.project.create({ data: { orgId: organization.id, name: "Fix 32 Truth Loop", slug: `fix32-truth-project-${nonce}`, status: "active", createdBy: user.id } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: user.id, projectRole: "manager", canApproveTruthChanges: true } });
  const document = await prisma.document.create({ data: { projectId: project.id, kind: "prd", title: "Fix 32 Source PRD", uploadedBy: user.id, visibility: "internal" } });
  const version = await prisma.documentVersion.create({
    data: { documentId: document.id, projectId: project.id, fileKey: `fix32/${nonce}.md`, checksumSha256: nonce.replaceAll("-", "").padEnd(64, "0").slice(0, 64), mimeType: "text/markdown", fileSize: 128n, status: "ready", parseConfidence: 1, sourceLabel: "fix32-synthetic", uploadedBy: user.id, processedAt: new Date() }
  });
  await prisma.document.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
  const section = await prisma.documentSection.create({
    data: { documentVersionId: version.id, projectId: project.id, sectionKey: "launch-policy", headingPath: ["Launch policy"], anchorId: "launch-policy", anchorText: "Launch policy", normalizedText: "Launch requires human approval and verified evidence.", orderIndex: 0 }
  });
  const evidenceRefs = [{ documentId: document.id, documentVersionId: version.id, sectionId: section.id, excerpt: "Launch requires human approval and verified evidence." }];
  await prisma.artifactVersion.create({
    data: { projectId: project.id, artifactType: "source_package", versionNumber: 1, status: "accepted", payloadJson: { projectSummary: "Synthetic Fix 32 launch policy", actors: ["release manager"], features: ["evidence-gated release"], constraints: ["human approval"], integrations: [], contradictions: [], unknowns: [], risks: ["unverified release"], sourceConfidence: 1, evidenceRefs }, sourceRefsJson: evidenceRefs, createdBy: user.id, acceptedAt: new Date() }
  });
  await prisma.artifactVersion.create({
    data: { projectId: project.id, artifactType: "clarified_brief", versionNumber: 1, status: "accepted", payloadJson: { summary: "Release only after human approval and verified evidence.", targetUsers: ["release manager"], flows: ["verify staging then approve release"], scope: ["release governance"], constraints: ["human approval"], integrations: [], unresolvedDecisions: [], assumptions: [], risks: ["unverified release"], evidenceRefs }, sourceRefsJson: evidenceRefs, createdBy: user.id, acceptedAt: new Date() }
  });
  const brainGraph = await prisma.artifactVersion.create({
    data: { projectId: project.id, artifactType: "brain_graph", versionNumber: 1, status: "accepted", payloadJson: { nodes: [{ nodeKey: "launch-policy", nodeType: "constraint", title: "Launch policy", summary: "Human approval is required.", status: "active", priority: "high", linkedSectionIds: [section.id] }], edges: [], criticalPaths: ["verify staging then approve release"], riskyAreas: ["unverified release"], unresolvedAreas: [] }, sourceRefsJson: evidenceRefs, createdBy: user.id, acceptedAt: new Date() }
  });
  const initialBrain = await prisma.artifactVersion.create({
    data: { projectId: project.id, artifactType: "product_brain", versionNumber: 1, status: "accepted", payloadJson: { whatTheProductIs: "Synthetic release governance", whoItIsFor: ["release manager"], mainFlows: ["verify and approve"], modules: ["release gate"], constraints: ["human approval"], integrations: [], unresolvedAreas: [], acceptedDecisions: [], recentAcceptedChanges: [], evidenceRefs }, sourceRefsJson: evidenceRefs, createdBy: user.id, acceptedAt: new Date() }
  });
  const brainNode = await prisma.brainNode.create({
    data: { artifactVersionId: brainGraph.id, projectId: project.id, nodeKey: "launch-policy", nodeType: "constraint", title: "Launch policy", summary: "Human approval is required.", status: "active", priority: "high" }
  });

  const login = object(await request(baseUrl, "/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
  const token = String(login.accessToken ?? "");
  if (!token) throw new Error("truth-loop login did not return an access token");
  const created = object(await request(baseUrl, `/v1/projects/${project.id}/change-proposals`, {
    method: "POST",
    body: JSON.stringify({
      title: "Require verified release evidence",
      summary: "Production release requires human approval plus verified staging evidence.",
      proposalType: "decision_change",
      oldUnderstanding: { decision: "Human approval is required." },
      newUnderstanding: { decision: "Human approval and verified staging evidence are required." },
      impactSummary: { surfaces: ["Product Brain", "Live Doc"] },
      affectedDocumentSectionIds: [section.id],
      affectedBrainNodeIds: [brainNode.id],
      communicationMessageIds: [],
      externalEvidenceRefs: [`synthetic:fix32:${nonce}`]
    })
  }, token));
  const proposalId = String(created.id ?? "");
  if (!proposalId || created.status !== "needs_review") throw new Error("proposal was not created in needs_review state");

  const accepted = object(await request(baseUrl, `/v1/projects/${project.id}/change-proposals/${proposalId}/accept`, { method: "POST", body: JSON.stringify({}) }, token));
  if (accepted.status !== "accepted") throw new Error("proposal acceptance did not return accepted state");

  const deadline = Date.now() + 180_000;
  let proof: { acceptedBrainVersionId: string | null; liveDocRevisionId: string | null; liveDocArtifactId: string | null } | null = null;
  while (Date.now() < deadline) {
    const [proposal, revision, liveDocArtifact] = await Promise.all([
      prisma.specChangeProposal.findUnique({ where: { id: proposalId } }),
      prisma.liveDocSectionRevision.findFirst({ where: { projectId: project.id, proposalId, eventType: "proposal_accepted" } }),
      prisma.artifactVersion.findFirst({ where: { projectId: project.id, artifactType: "live_doc" }, orderBy: { versionNumber: "desc" } })
    ]);
    proof = { acceptedBrainVersionId: proposal?.acceptedBrainVersionId ?? null, liveDocRevisionId: revision?.id ?? null, liveDocArtifactId: liveDocArtifact?.id ?? null };
    if (proof.acceptedBrainVersionId && proof.liveDocRevisionId && proof.liveDocArtifactId) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (!proof?.acceptedBrainVersionId || !proof.liveDocRevisionId || !proof.liveDocArtifactId) throw new Error("worker did not persist Product Brain and Live Doc truth before timeout");
  const brainVersion = await prisma.artifactVersion.findUnique({ where: { id: proof.acceptedBrainVersionId } });
  if (!brainVersion || brainVersion.projectId !== project.id || brainVersion.versionNumber <= initialBrain.versionNumber) throw new Error("accepted proposal did not create a newer authoritative Product Brain version");

  const initialOverview = object(await request(baseUrl, `/v1/projects/${project.id}/delivery?refresh=true`, {}, token));
  const initialHealth = object(initialOverview.contextHealth);
  const initialReleaseTruth = object(initialOverview.releaseTruth);
  if (!Array.isArray(initialHealth.components) || initialHealth.components.length !== 9) throw new Error("Context Health did not return all nine evidence-backed components");
  if (!Array.isArray(initialReleaseTruth.acceptedChanges) || !Array.isArray(initialReleaseTruth.blockers)) throw new Error("Release Truth returned an incomplete contract");

  const firstBrief = object(await request(baseUrl, `/v1/projects/${project.id}/delivery/weekly-brief`, { method: "POST", body: "{}" }, token));
  const secondBrief = object(await request(baseUrl, `/v1/projects/${project.id}/delivery/weekly-brief`, { method: "POST", body: "{}" }, token));
  if (!firstBrief.id || firstBrief.id !== secondBrief.id || firstBrief.sourceFingerprint !== secondBrief.sourceFingerprint) throw new Error("Weekly Executive Brief was not idempotent for the same evidence window");

  const preflight = object(await request(baseUrl, `/v1/projects/${project.id}/delivery/agent-preflight`, {
    method: "POST",
    body: JSON.stringify({ taskPrompt: "Implement the accepted verified-release decision and record tests plus deployment evidence.", proposalId, targetAgent: "codex", budgetPreset: "normal" })
  }, token));
  const contextPack = object(preflight.contextPack);
  const contextPackId = String(contextPack.id ?? "");
  if (!contextPackId || !Array.isArray(preflight.implementationBoundaries)) throw new Error("Agent Preflight did not return its persisted context pack and implementation boundaries");
  const proposalSource = await prisma.agentContextPackSource.findFirst({ where: { projectId: project.id, packId: contextPackId, sourceRefType: "change_proposal", sourceRefId: proposalId } });
  if (!proposalSource) throw new Error("Agent Preflight did not pin the selected proposal into its context pack");

  // Raw Agent Run creation is intentionally not browser-exposed in beta;
  // completed runs arrive through the existing MCP/agent evidence boundary.
  // Seed that external evidence directly, then exercise public Postflight.
  const packRecord = await prisma.agentContextPack.findUniqueOrThrow({ where: { id: contextPackId } });
  const agentRun = await prisma.agentRun.create({
    data: {
      orgId: organization.id,
      projectId: project.id,
      contextPackId,
      contextPackGeneratedAt: packRecord.generatedAt,
      createdByUserId: user.id,
      targetAgentJson: { name: "Codex", kind: "codex" },
      provider: "codex",
      taskTitle: "Implement verified release decision",
      taskType: "implementation",
      taskDescription: "Synthetic staging proof for the approved decision-to-delivery workflow.",
      promptSource: "context_pack",
      status: "completed",
      outputSummary: "Implemented the approved release evidence requirement.",
      implementationNotes: "No accepted truth was mutated by the agent run.",
      branchName: "staging/features-4-10",
      commitSha: "abcdef1234567",
      filesChangedJson: ["src/release-gate.ts"],
      modulesTouchedJson: ["release governance"],
      testsRunJson: ["release gate staging verification passed"],
      testStatus: "passed",
      docsUpdatedJson: ["docs/release-gate.md"],
      risksFoundJson: [],
      followUpQuestionsJson: [],
      limitationsJson: ["Synthetic isolated-staging evidence only."],
      warningsJson: [],
      visibility: "internal"
    }
  });
  const agentRunId = agentRun.id;
  if (!agentRunId) throw new Error("Agent Run was not persisted");
  const postflight = object(await request(baseUrl, `/v1/projects/${project.id}/delivery/agent-postflight/${agentRunId}`, { method: "POST", body: "{}" }, token));
  if (postflight.acceptedTruthChanged !== false || !object(postflight.review).recommendation) throw new Error("Agent Postflight did not return an evidence-only quality review");
  await prisma.agentRun.update({
    where: { id: agentRunId },
    data: {
      status: "accepted",
      humanReviewResult: "accepted",
      humanReviewNotes: "Synthetic staging evidence reviewed and accepted.",
      reviewedByUserId: user.id,
      reviewedAt: new Date(),
      requiresHumanReview: false,
      unverifiedClaims: false,
      possibleProductBrainImplications: false
    }
  });

  const acceptedProposal = await prisma.specChangeProposal.findUnique({ where: { id: proposalId } });
  if (!acceptedProposal?.decisionRecordId) throw new Error("Accepted proposal did not retain a decision record for delivery evidence");
  const evidenceRows = await Promise.all([
    prisma.engineeringEvidenceItem.create({ data: { orgId: organization.id, projectId: project.id, provider: "manual", sourceType: "release_proof", sourceSubType: "commit", evidenceKey: `fix32-implementation-${nonce}`, sha: "abcdef1234567", occurredAt: new Date(), status: "completed", confidence: "high", title: "Implementation commit", summary: "Approved release gate implementation recorded.", sourceUrl: "https://example.com/staging/commit", citationJson: {}, openTargetJson: {}, metadataJson: { synthetic: true } } }),
    prisma.engineeringEvidenceItem.create({ data: { orgId: organization.id, projectId: project.id, provider: "manual", sourceType: "release_proof", sourceSubType: "ci_test", evidenceKey: `fix32-test-${nonce}`, occurredAt: new Date(), status: "success", confidence: "high", title: "Release tests", summary: "Authoritative staging tests passed.", sourceUrl: "https://example.com/staging/tests", citationJson: {}, openTargetJson: {}, metadataJson: { synthetic: true } } }),
    prisma.engineeringEvidenceItem.create({ data: { orgId: organization.id, projectId: project.id, provider: "manual", sourceType: "release_proof", sourceSubType: "deployment", evidenceKey: `fix32-deployment-${nonce}`, environment: "staging", occurredAt: new Date(), status: "succeeded", confidence: "high", title: "Staging deployment", summary: "Staging deployment succeeded.", sourceUrl: "https://example.com/staging/deployment", citationJson: {}, openTargetJson: {}, metadataJson: { synthetic: true } } })
  ]);
  await prisma.fdeDecisionEngineeringLink.create({ data: { orgId: organization.id, projectId: project.id, decisionId: acceptedProposal.decisionRecordId, targetType: "release", targetRef: `staging:${nonce}`, relationshipType: "implemented_by", evidenceIdsJson: evidenceRows.map((row) => row.id), citationsJson: [], openTargetsJson: [], limitationsJson: ["Synthetic isolated-staging proof."], metadataJson: { synthetic: true }, createdByUserId: user.id } });

  const trace = object(await request(baseUrl, `/v1/projects/${project.id}/delivery/traces/${encodeURIComponent(`proposal:${proposalId}`)}`, {}, token));
  if (trace.status !== "delivered" || trace.receiptEligible !== true || !Array.isArray(trace.steps) || trace.steps.length !== 11) throw new Error("Decision-to-Delivery Trace did not reach delivered with the complete persisted evidence chain");
  const firstReceipt = object(await request(baseUrl, `/v1/projects/${project.id}/delivery/receipts/${encodeURIComponent(`proposal:${proposalId}`)}`, { method: "POST", body: "{}" }, token));
  const secondReceipt = object(await request(baseUrl, `/v1/projects/${project.id}/delivery/receipts/${encodeURIComponent(`proposal:${proposalId}`)}`, { method: "POST", body: "{}" }, token));
  if (firstReceipt.immutable !== true || firstReceipt.id !== secondReceipt.id || firstReceipt.contentHash !== secondReceipt.contentHash) throw new Error("Decision Receipt was not immutable and idempotent");

  const answer = object(await request(baseUrl, `/v1/projects/${project.id}/socrates/v1/ask`, { method: "POST", body: JSON.stringify({ question: "wassup", selectedSources: ["all"] }) }, token));
  const sessionId = String(answer.sessionId ?? "");
  const assistantMessageId = String(answer.messageId ?? "");
  if (!sessionId || !assistantMessageId) throw new Error("Socrates did not persist the response required for feedback");
  const feedback = object(await request(baseUrl, `/v1/projects/${project.id}/socrates/sessions/${sessionId}/messages/${assistantMessageId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ reason: "missing_evidence", correctionText: "The answer should cite the accepted release decision when the question requires project evidence." })
  }, token));
  if (feedback.needsHumanReview !== true || feedback.acceptedTruthChanged !== false) throw new Error("Socrates feedback did not remain review evidence outside accepted truth");
  const persistedFeedback = await prisma.socratesResponseFeedback.findUnique({ where: { assistantMessageId_userId: { assistantMessageId, userId: user.id } } });
  if (!persistedFeedback || persistedFeedback.reason !== "missing_evidence") throw new Error("Socrates feedback did not survive authoritative database reload");

  const finalOverview = object(await request(baseUrl, `/v1/projects/${project.id}/delivery?refresh=true`, {}, token));
  const finalHealth = object(finalOverview.contextHealth);
  const quality = (finalHealth.components as Array<Record<string, unknown>>).find((component) => component.key === "socrates_quality");
  if (!quality || quality.state !== "attention" || object(finalOverview.weeklyBrief).id !== firstBrief.id) throw new Error("Context Health did not surface pending Socrates review or persisted Weekly Brief state");

  console.log(JSON.stringify({ ok: true, liveProof: true, environment: "isolated_staging", projectId: project.id, proposalId, proposalStatus: "accepted", productBrainVersion: brainVersion.versionNumber, delivery: { traceStatus: trace.status, receiptId: firstReceipt.id, weeklyBriefId: firstBrief.id, contextPackId, agentRunId, postflightRecommendation: object(postflight.review).recommendation, contextHealthState: finalHealth.state, feedbackReason: feedback.reason }, ...proof }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? `Fix 32 truth-loop runtime failed: ${error.message}` : String(error));
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
