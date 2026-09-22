import { describe, expect, it, vi } from "vitest";
import { DeliveryIntelligenceService } from "../src/modules/delivery/service.js";

const ACTOR = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222" };
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-08-24T01:00:00.000Z");
const sha = "a".repeat(40);

function evidence(id: string, sourceSubType: string, status: string, summary: string) {
  return { id, provider: "github", sourceSubType, title: sourceSubType, summary, status, sha, repositoryOwner: "org", repositoryName: "repo", occurredAt: now, sourceUrl: `https://github.com/org/repo/${id}`, environment: "production", archivedAt: null };
}

function githubEvidence(id: string, evidenceType: string, status: string, summary: string, overrides: Record<string, unknown> = {}) {
  return { id, evidenceType, providerId: `${evidenceType}:${id}`, title: evidenceType, summary, status, sha, repositoryOwner: "org", repositoryName: "repo", occurredAt: now, sourceUrl: `https://github.com/org/repo/${id}`, payloadJson: { environment: "production" }, evidenceStatus: "active", createdAt: now, ...overrides };
}

function harness(options: { deploymentStatus?: string; deploymentSummary?: string } = {}) {
  const proposal = {
    id: PROPOSAL_ID, projectId: PROJECT_ID, title: "Ship the approved login change", summary: "Add approved Google login.", proposalType: "requirement_change", status: "accepted",
    acceptedAt: now, acceptedBrainVersionId: "brain-version-1", decisionRecordId: "decision-1", externalEvidenceRefsJson: [], impactSummaryJson: { areas: ["Authentication"] },
    links: [{ linkType: "message", linkRefId: "message-1", createdAt: now }],
    decisionRecord: { statement: "Google login is required before launch." }, accepter: { displayName: "Truth Approver" }, decisionReceipt: null,
    createdAt: now, updatedAt: now
  };
  const rows = [
    evidence("commit-1", "commit", "completed", "Implementation commit"),
    evidence("test-1", "ci_test", "success", "Release tests passed"),
    evidence("deploy-1", "deployment", options.deploymentStatus ?? "succeeded", options.deploymentSummary ?? "Production deployment succeeded")
  ];
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue({ id: PROJECT_ID }) },
    specChangeProposal: { findFirst: vi.fn().mockResolvedValue(proposal), findUniqueOrThrow: vi.fn().mockResolvedValue(proposal), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    decisionRecord: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    truthInboxItemState: { findUnique: vi.fn().mockResolvedValue({ assignedUserId: ACTOR.userId, assignedUser: { displayName: "Karthik", email: "k@example.com" }, updatedAt: now }) },
    liveDocSectionRevision: { findMany: vi.fn().mockResolvedValue([]) },
    agentContextPackSource: { findMany: vi.fn().mockResolvedValue([{ pack: { id: "pack-1", title: "Implementation preflight", generatedAt: now, status: "active" } }]) },
    fdeDecisionEngineeringLink: { findMany: vi.fn().mockResolvedValue([{ evidenceIdsJson: rows.map((row) => row.id), updatedAt: now }]) },
    agentRun: { findMany: vi.fn().mockResolvedValue([{ id: "run-1", contextPackId: "pack-1", taskTitle: "Implement login", status: "completed", humanReviewResult: "accepted", testStatus: "passed", prUrl: "https://github.com/org/repo/pull/1", commitSha: sha, outputSummary: "done", updatedAt: now, reviewedAt: now }]) },
    brainNode: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(1) },
    fdeReadinessFinding: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null) },
    projectCodingRequirements: { findMany: vi.fn().mockResolvedValue([]) },
    projectResponsibility: { findMany: vi.fn().mockResolvedValue([]) },
    engineeringEvidenceItem: { findMany: vi.fn().mockResolvedValue(rows) },
    gitHubEngineeringEvidence: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    agentMarkdownFileVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    agentQualityReview: { findMany: vi.fn().mockResolvedValue([]) },
    document: { count: vi.fn().mockResolvedValue(1) },
    socratesResponseFeedback: { count: vi.fn().mockResolvedValue(0) },
    weeklyExecutiveBrief: { findFirst: vi.fn().mockResolvedValue(null) },
    decisionReceipt: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async ({ create }: any) => ({ id: "receipt-1", proposalId: PROPOSAL_ID, decisionRecordId: "decision-1", receiptVersion: 1, contentHash: create.contentHash, receiptJson: create.receiptJson, issuedAt: create.issuedAt }))
    }
  };
  const projectService = { ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ projectRole: "manager" }), ensureProjectTruthApprover: vi.fn().mockResolvedValue({ projectRole: "manager" }) };
  const contextPacks = { createPack: vi.fn().mockResolvedValue({ id: "pack-new", title: "Preflight", bodyMarkdown: "# Preflight", sources: [], sourceCount: 0, evidenceCount: 0, warnings: [], limitations: [] }) };
  const service = new DeliveryIntelligenceService(prisma as any, projectService as any, { record: vi.fn() } as any, { getProjectIntegrationStatus: vi.fn().mockResolvedValue({ providers: [] }) } as any, contextPacks as any, {} as any, {} as any);
  return { service, prisma, contextPacks };
}

describe("DeliveryIntelligenceService", () => {
  it("does not turn generated graph inventory into accepted truth or healthy evidence coverage", async () => {
    const { service, prisma } = harness();
    prisma.brainNode.count.mockResolvedValue(9);
    prisma.document.count.mockResolvedValue(2);
    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);
    const coverage = overview.contextHealth.components.find((item) => item.key === "evidence_coverage");
    expect(coverage).toMatchObject({ state: "attention", summary: "0 accepted decision(s); 0 accepted change(s)." });
    expect(coverage?.detail).toEqual(expect.arrayContaining(["2 source document(s) and 9 active Product Brain node(s) are stored as context; these counts do not establish approval."]));
  });

  it("counts actual project-wide approvals separately without inventing requirement-to-source coverage", async () => {
    const { service, prisma } = harness();
    prisma.decisionRecord.count.mockResolvedValue(3);
    prisma.specChangeProposal.count.mockImplementation(async ({ where }: any) => where.status === "accepted" ? 4 : 0);
    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);
    const coverage = overview.contextHealth.components.find((item) => item.key === "evidence_coverage");
    expect(coverage).toMatchObject({ state: "unknown", summary: "3 accepted decision(s); 4 accepted change(s)." });
    expect(prisma.decisionRecord.count).toHaveBeenCalledWith({ where: { projectId: PROJECT_ID, status: "accepted" } });
    expect(prisma.specChangeProposal.count).toHaveBeenCalledWith({ where: { projectId: PROJECT_ID, status: "accepted" } });
    expect(coverage?.detail.join(" ")).toContain("Requirement-to-source coverage has not been verified");
  });

  it("keeps an empty context inventory blocked", async () => {
    const { service, prisma } = harness();
    prisma.brainNode.count.mockResolvedValue(0);
    prisma.document.count.mockResolvedValue(0);
    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);
    expect(overview.contextHealth.components.find((item) => item.key === "evidence_coverage")?.state).toBe("blocked");
  });

  it("keeps review-only findings out of delivery and receipt claims", async () => {
    const { service } = harness();
    const trace = await service.getTrace(PROJECT_ID, "suggestion:signal-1", ACTOR);
    expect(trace).toMatchObject({ status: "review_only", receiptEligible: false, steps: [] });
  });

  it("requires the complete persisted decision-to-delivery evidence chain", async () => {
    const { service } = harness();
    const trace = await service.getTrace(PROJECT_ID, `proposal:${PROPOSAL_ID}`, ACTOR);
    expect(trace.status).toBe("delivered");
    expect(trace.receiptEligible).toBe(true);
    expect(trace.receiptBlockers).toEqual([]);
    expect(trace.steps.find((step) => step.key === "tests_passed")?.status).toBe("complete");
    expect(trace.steps.find((step) => step.key === "deployment_observed")?.status).toBe("complete");
    expect(trace.steps.find((step) => step.key === "implementation_verified")?.status).toBe("complete");
  });

  it("does not mislabel a bare active or failed deployment as successful", async () => {
    for (const deployment of [{ status: "active", summary: "Deployment record active" }, { status: "failed", summary: "Production deployment failed" }]) {
      const { service } = harness({ deploymentStatus: deployment.status, deploymentSummary: deployment.summary });
      const trace = await service.getTrace(PROJECT_ID, `proposal:${PROPOSAL_ID}`, ACTOR);
      expect(trace.status).toBe("in_delivery");
      expect(trace.receiptEligible).toBe(false);
      expect(trace.steps.find((step) => step.key === "deployment_observed")?.status).toBe("blocked");
      expect(trace.steps.find((step) => step.key === "implementation_verified")?.status).toBe("blocked");
    }
  });

  it("does not let manual registry claims satisfy provider-backed receipt gates", async () => {
    const { service, prisma } = harness();
    prisma.engineeringEvidenceItem.findMany.mockImplementation(async () => [
      { ...evidence("commit-1", "commit", "completed", "Implementation commit"), provider: "manual" },
      { ...evidence("test-1", "ci_test", "success", "Release tests passed"), provider: "manual" },
      { ...evidence("deploy-1", "deployment", "succeeded", "Production deployment succeeded"), provider: "manual" }
    ]);

    const trace = await service.getTrace(PROJECT_ID, `proposal:${PROPOSAL_ID}`, ACTOR);
    expect(trace.receiptEligible).toBe(false);
    expect(trace.steps.find((step) => step.key === "deployment_observed")?.status).toBe("blocked");
  });

  it("issues one immutable receipt and returns it idempotently", async () => {
    const { service, prisma } = harness();
    const first = await service.issueReceipt(PROJECT_ID, `proposal:${PROPOSAL_ID}`, ACTOR);
    prisma.decisionReceipt.findUnique.mockResolvedValueOnce({ id: first.id, proposalId: PROPOSAL_ID, decisionRecordId: "decision-1", receiptVersion: 1, contentHash: first.contentHash, receiptJson: first.content, issuedAt: new Date(first.issuedAt) });
    const second = await service.issueReceipt(PROJECT_ID, `proposal:${PROPOSAL_ID}`, ACTOR);
    expect(first).toMatchObject({ id: "receipt-1", immutable: true, content: { acceptedWording: "Google login is required before launch." } });
    expect(first.contentHash).toHaveLength(64);
    expect(second).toEqual(first);
    expect(prisma.decisionReceipt.upsert).toHaveBeenCalledTimes(1);
  });

  it.each(["queued", "in_progress", "completed", "unsuccessful"])("blocks receipts for non-success deployment %s", async (status) => {
    const { service } = harness({ deploymentStatus: status });
    await expect(service.issueReceipt(PROJECT_ID, `proposal:${PROPOSAL_ID}`, ACTOR)).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each(["sha", "repositoryName"])("blocks evidence for a different %s", async (field) => {
    const { service, prisma } = harness();
    const rows = await prisma.engineeringEvidenceItem.findMany();
    prisma.engineeringEvidenceItem.findMany.mockResolvedValue(rows.map((row: ReturnType<typeof evidence>) => row.id === "test-1" ? { ...row, [field]: field === "sha" ? "b".repeat(40) : "unrelated" } : row));
    expect((await service.getTrace(PROJECT_ID, `proposal:${PROPOSAL_ID}`, ACTOR)).receiptEligible).toBe(false);
  });

  it("pins a selected proposal into the generated Agent Preflight context pack", async () => {
    const { service, prisma, contextPacks } = harness();
    prisma.specChangeProposal.findMany = vi.fn().mockResolvedValue([{ id: PROPOSAL_ID, title: "Approved login change", summary: "Add login", proposalType: "requirement_change" }]);
    await service.generatePreflight(PROJECT_ID, ACTOR, {
      taskPrompt: "Implement the approved login change",
      proposalId: PROPOSAL_ID,
      targetAgent: "codex",
      budgetPreset: "normal"
    });
    expect(contextPacks.createPack).toHaveBeenCalledWith(PROJECT_ID, ACTOR.userId, expect.objectContaining({
      sourceMode: "other",
      seedReference: { type: "change_proposal", id: PROPOSAL_ID, label: "Approved login change" }
    }));
  });

  it("blocks Agent Preflight when accepted truth, evidence, and test requirements are absent", async () => {
    const { service } = harness();
    const preflight = await service.generatePreflight(PROJECT_ID, ACTOR, {
      taskPrompt: "Add role-gated CSV export for the project timeline with tests.",
      targetAgent: "codex",
      budgetPreset: "normal"
    });

    expect(preflight).toMatchObject({ ready: false, readinessLabel: "blocked" });
    expect(preflight.blockers).toEqual(expect.arrayContaining([
      "No accepted Product Brain truth is available for this project.",
      "No supporting project evidence is available for this task.",
      "No project testing or acceptance requirements are recorded for this task."
    ]));
  });

  it("does not count generated graph nodes as approval even when their artifact is auto-accepted", async () => {
    const { service, prisma, contextPacks } = harness();
    prisma.brainNode.findMany.mockResolvedValue([{ title: "Imported PRD", summary: "Unapproved CSV request", nodeType: "requirement", priority: "high" }, { title: "Saved research", summary: "Generated manual note", nodeType: "constraint", priority: "high" }]);
    prisma.projectCodingRequirements.findMany.mockResolvedValue([{ artifactVersion: { payloadJson: { tests: "Verify CSV" }, status: "accepted", versionNumber: 1 } }]);
    contextPacks.createPack.mockResolvedValue({ id: "pack", title: "Preflight", bodyMarkdown: "# Preflight", sources: [{ title: "Imported PRD" }], sourceCount: 1, evidenceCount: 1, warnings: [], limitations: [] });
    const result = await service.generatePreflight(PROJECT_ID, ACTOR, { taskPrompt: "Implement CSV export", targetAgent: "codex", budgetPreset: "normal" });
    expect(result).toMatchObject({ ready: false, readinessLabel: "blocked", currentAcceptedTruth: [], technicalConstraints: [] });
    expect(result.blockers).toContain("No accepted Product Brain truth is available for this project.");
    expect(result.relevantEvidence).toContain("Imported PRD");
  });

  it("blocks preflight for persisted blocking severity without depending on summary wording", async () => {
    const { service, prisma, contextPacks } = harness();
    prisma.brainNode.findMany.mockResolvedValue([{ title: "Login", summary: "Approved", nodeType: "requirement", priority: "high" }]);
    prisma.projectCodingRequirements.findMany.mockResolvedValue([{ artifactVersion: { payloadJson: { tests: "Verify login" }, status: "active", versionNumber: 1 } }]);
    contextPacks.createPack.mockResolvedValue({ id: "pack", title: "Preflight", bodyMarkdown: "# Preflight", sources: [], sourceCount: 1, evidenceCount: 1, warnings: [], limitations: [] });
    prisma.fdeReadinessFinding.findMany.mockResolvedValue([{ id: "finding", findingType: "implementation_mismatch", severity: "blocking", summary: "Authentication diverges from approved scope", suggestedAction: "Review implementation", targetKind: "module" }]);
    const result = await service.generatePreflight(PROJECT_ID, ACTOR, { taskPrompt: "Implement approved login", targetAgent: "codex", budgetPreset: "normal" });
    expect(result).toMatchObject({ ready: false, readinessLabel: "blocked" });
    expect(result.blockers).toContain("Blocking finding: Authentication diverges from approved scope");
  });

  it("blocks preflight for a blocking finding beyond the 40-row display window", async () => {
    const { service, prisma, contextPacks } = harness();
    prisma.brainNode.findMany.mockResolvedValue([{ title: "Login", summary: "Approved", nodeType: "requirement", priority: "high" }]);
    prisma.projectCodingRequirements.findMany.mockResolvedValue([{ artifactVersion: { payloadJson: { tests: "Verify login" }, status: "active", versionNumber: 1 } }]);
    contextPacks.createPack.mockResolvedValue({ id: "pack", title: "Preflight", bodyMarkdown: "# Preflight", sources: [], sourceCount: 1, evidenceCount: 1, warnings: [], limitations: [] });
    prisma.fdeReadinessFinding.findMany.mockImplementation(async ({ take }: { take?: number }) => take ? Array.from({ length: take }, (_, index) => ({ id: `info-${index}`, findingType: "safe_to_touch", severity: "info", summary: `Informational ${index}`, suggestedAction: null, targetKind: "module" })) : []);
    prisma.fdeReadinessFinding.count.mockResolvedValue(1);
    prisma.fdeReadinessFinding.findFirst.mockResolvedValue({ id: "old-blocker", findingType: "implementation_mismatch", severity: "blocking", summary: "Older unresolved blocker", suggestedAction: "Resolve before work", targetKind: "module" });

    const result = await service.generatePreflight(PROJECT_ID, ACTOR, { taskPrompt: "Implement approved login", targetAgent: "codex", budgetPreset: "normal" });

    expect(result).toMatchObject({ ready: false, readinessLabel: "blocked" });
    expect(result.blockers).toContain("Blocking finding: Older unresolved blocker");
    expect(prisma.fdeReadinessFinding.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: PROJECT_ID }) }));
  });

  it("blocks a scoped preflight for a contradiction found in the complete project scope", async () => {
    const { service, prisma, contextPacks } = harness();
    prisma.decisionRecord.findMany.mockResolvedValue([{ id: "decision-login", title: "Login", statement: "Use approved login." }]);
    prisma.brainNode.findMany.mockResolvedValue([{ title: "Login", summary: "Approved", nodeType: "requirement", priority: "high" }]);
    prisma.projectCodingRequirements.findMany.mockResolvedValue([{ artifactVersion: { payloadJson: { tests: "Verify login" }, status: "active", versionNumber: 1 } }]);
    contextPacks.createPack.mockResolvedValue({ id: "pack", title: "Preflight", bodyMarkdown: "# Preflight", sources: [], sourceCount: 1, evidenceCount: 1, warnings: [], limitations: [] });
    prisma.specChangeProposal.count.mockResolvedValue(1);
    prisma.specChangeProposal.findFirst.mockResolvedValue({ title: "Launch scope conflicts with auth", summary: "Resolve the project contradiction" });

    const result = await service.generatePreflight(PROJECT_ID, ACTOR, { taskPrompt: "Implement approved login", proposalId: PROPOSAL_ID, targetAgent: "codex", budgetPreset: "normal" });

    expect(result).toMatchObject({ ready: false, readinessLabel: "needs_decision" });
    expect(result.blockers).toContain("1 unresolved project-wide contradiction(s) (example: Launch scope conflicts with auth).");
  });

  it("allows Agent Preflight only when accepted truth, evidence, and test requirements exist", async () => {
    const { service, prisma, contextPacks } = harness();
    prisma.decisionRecord.findMany.mockResolvedValueOnce([
      { id: "decision-timeline", title: "Timeline exports", statement: "Managers can export project timeline evidence." }
    ]);
    prisma.projectCodingRequirements.findMany.mockResolvedValueOnce([
      { artifactVersion: { payloadJson: { acceptance: ["Verify manager export and deny client export"] }, status: "accepted", versionNumber: 1 } }
    ]);
    contextPacks.createPack.mockResolvedValueOnce({
      id: "pack-evidenced",
      title: "Preflight",
      bodyMarkdown: "# Preflight",
      sources: [{ title: "Accepted timeline requirement" }],
      sourceCount: 1,
      evidenceCount: 1,
      warnings: [],
      limitations: []
    });

    const preflight = await service.generatePreflight(PROJECT_ID, ACTOR, {
      taskPrompt: "Add role-gated CSV export for the project timeline with tests.",
      targetAgent: "codex",
      budgetPreset: "normal"
    });

    expect(preflight).toMatchObject({ ready: true, readinessLabel: "ready", blockers: [] });
    expect(preflight.currentAcceptedTruth).toEqual(["Timeline exports: Managers can export project timeline evidence."]);
    expect(prisma.decisionRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: PROJECT_ID, status: "accepted" } }));
  });

  it("deduplicates noisy conflicts and does not repeat blockers as open questions", async () => {
    const { service, prisma } = harness();
    prisma.specChangeProposal.findMany.mockImplementation(async ({ where }: any) => where.status === "accepted" ? [] : [
      { id: "proposal-a", title: "Message suggests a requirement change.", summary: "Message suggests a requirement change.", proposalType: "requirement_change" },
      { id: "proposal-b", title: "Message suggests a requirement change.", summary: "Message suggests a requirement change.", proposalType: "requirement_change" }
    ]);

    const preflight = await service.generatePreflight(PROJECT_ID, ACTOR, {
      taskPrompt: "Build the accepted project requirement",
      targetAgent: "codex",
      budgetPreset: "normal"
    });

    expect(preflight.knownConflicts).toEqual(["Message suggests a requirement change."]);
    expect(preflight.openQuestions).not.toEqual(expect.arrayContaining(preflight.blockers));
  });

  it("does not let an older successful revision certify a newer failed production revision", async () => {
    const { service, prisma } = harness();
    const oldSha = "a".repeat(40);
    const newerSha = "b".repeat(40);
    const older = new Date("2026-08-20T01:00:00.000Z");
    const newer = new Date("2026-08-24T01:00:00.000Z");
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([
      githubEvidence("old-commit", "github_commit", "completed", "Old implementation", { sha: oldSha, occurredAt: older }),
      githubEvidence("old-test", "github_check_run", "success", "Old tests", { sha: oldSha, occurredAt: older }),
      githubEvidence("old-deploy", "github_deployment", "success", "Old production deploy", { sha: oldSha, occurredAt: older }),
      githubEvidence("new-commit", "github_commit", "completed", "New implementation", { sha: newerSha, occurredAt: newer }),
      githubEvidence("new-test", "github_check_run", "failed", "New tests failed", { sha: newerSha, occurredAt: newer }),
      githubEvidence("new-deploy", "github_deployment", "failed", "New production deploy failed", { sha: newerSha, occurredAt: newer })
    ]);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth.readiness).toBe("needs_attention");
    expect(overview.releaseTruth.blockers).toEqual(expect.arrayContaining(["Latest production deployment for org/repo@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb did not succeed."]));
  });

  it("blocks overview release truth for a blocker outside its 60-row display window", async () => {
    const { service, prisma } = harness();
    prisma.fdeReadinessFinding.findMany.mockImplementation(async ({ take }: { take?: number }) => take ? Array.from({ length: take }, (_, index) => ({ id: `info-${index}`, findingType: "safe_to_touch", findingSubType: "none", severity: "info", summary: `Informational ${index}`, suggestedAction: null, updatedAt: now })) : []);
    prisma.fdeReadinessFinding.count.mockResolvedValue(1);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth.readiness).toBe("blocked");
    expect(overview.releaseTruth.blockers).toContain("1 active blocking or unsafe finding(s) exist across the authorized project scope.");
  });

  it("marks release truth unknown when persisted evidence cannot identify a candidate revision and scope", async () => {
    const { service, prisma } = harness();
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([githubEvidence("deploy", "github_deployment", "success", "Unscoped deployment", { sha: null, occurredAt: null })]);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth).toMatchObject({ readiness: "unknown", assessedRevision: null, assessmentScope: "Latest production observation is missing a full revision or repository identity." });
  });

  it("does not ignore a newer malformed production observation in favor of an older successful revision", async () => {
    const { service, prisma } = harness();
    const older = new Date("2026-08-20T01:00:00.000Z");
    const newer = new Date("2026-08-24T01:00:00.000Z");
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([
      githubEvidence("new-malformed", "github_deployment", "success", "Latest production deploy", { occurredAt: newer, sha: null }),
      githubEvidence("old-commit", "github_commit", "completed", "Old implementation", { occurredAt: older }),
      githubEvidence("old-test", "github_check_run", "success", "Old tests", { occurredAt: older }),
      githubEvidence("old-deploy", "github_deployment", "success", "Old production deploy", { occurredAt: older })
    ]);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth).toMatchObject({ readiness: "unknown", assessedRevision: null });
    expect(overview.releaseTruth.blockers).toContain("Latest production observation is missing a full revision or repository identity.");
  });

  it("returns unknown when the bounded production observation scope spans multiple repositories", async () => {
    const { service, prisma } = harness();
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([
      githubEvidence("repo-a", "github_deployment", "success", "Repo A deploy"),
      githubEvidence("repo-b", "github_deployment", "success", "Repo B deploy", { repositoryOwner: "other", repositoryName: "repo", sha: "b".repeat(40) })
    ]);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth).toMatchObject({ readiness: "unknown", assessedRevision: null });
    expect(overview.releaseTruth.blockers).toContain("Production observations span multiple repositories; no release candidate scope is selected.");
  });

  it("returns unknown for a stale production candidate", async () => {
    const { service, prisma } = harness();
    const stale = new Date(Date.now() - 31 * 86_400_000);
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([
      githubEvidence("commit", "github_commit", "completed", "Implementation", { occurredAt: stale }),
      githubEvidence("test", "github_check_run", "success", "Tests", { occurredAt: stale }),
      githubEvidence("deploy", "github_deployment", "success", "Production deploy", { occurredAt: stale })
    ]);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth).toMatchObject({ readiness: "unknown", assessedRevision: sha });
    expect(overview.releaseTruth.blockers).toContain(`Production candidate ${sha} is older than the 30-day freshness policy.`);
  });

  it("returns unknown when connected release evidence is stale despite a fresh candidate", async () => {
    const { service } = harness();
    const fresh = new Date();
    const staleSync = new Date(Date.now() - 31 * 86_400_000).toISOString();
    (service as any).integrationManagementService.getProjectIntegrationStatus.mockResolvedValue({ providers: [{ connected: true, degraded: false, needsReauth: false, label: "GitHub", lastSyncedAt: staleSync, status: "connected" }] });
    const prisma = (service as any).prisma;
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([
      githubEvidence("commit", "github_commit", "completed", "Implementation", { occurredAt: fresh }),
      githubEvidence("test", "github_check_run", "success", "Tests", { occurredAt: fresh }),
      githubEvidence("deploy", "github_deployment", "success", "Production deploy", { occurredAt: fresh })
    ]);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth.readiness).toBe("unknown");
    expect(overview.releaseTruth.blockers).toContain("Connected release evidence has not synced within the 30-day freshness policy.");
  });

  it("uses the latest outcome for a stable check identity instead of an obsolete failure", async () => {
    const { service, prisma } = harness();
    const older = new Date("2026-08-20T01:00:00.000Z");
    const newer = new Date("2026-08-24T01:00:00.000Z");
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([
      githubEvidence("commit", "github_commit", "completed", "Implementation", { occurredAt: newer }),
      githubEvidence("deploy", "github_deployment", "success", "Production deploy", { occurredAt: newer }),
      githubEvidence("check-old", "github_check_run", "failed", "Release checks", { providerId: "check:release", occurredAt: older }),
      githubEvidence("check-new", "github_check_run", "success", "Release checks", { providerId: "check:release", occurredAt: newer })
    ]);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth.blockers).not.toEqual(expect.arrayContaining([expect.stringContaining("Latest authoritative test outcome failed")]));
    expect(overview.releaseTruth.readiness).toBe("unknown");
  });

  it("certifies a complete current production candidate and reports its revision and authorized scope", async () => {
    const { service, prisma } = harness();
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([
      githubEvidence("commit", "github_commit", "completed", "Implementation"),
      githubEvidence("test", "github_check_run", "success", "Tests"),
      githubEvidence("deploy", "github_deployment", "success", "Production deploy")
    ]);

    const overview = await service.getOverview(PROJECT_ID, ACTOR, true);

    expect(overview.releaseTruth).toMatchObject({ readiness: "unknown", assessedRevision: sha, assessedRepository: "org/repo", assessedEnvironment: "production" });
    expect(overview.releaseTruth.assessmentScope).toContain("Latest 25 production observations");
    expect(overview.releaseTruth.assessmentScope).toContain("required-check inventory is not recorded");
    expect(prisma.gitHubEngineeringEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25, select: expect.objectContaining({ payloadJson: true, sha: true, repositoryOwner: true, repositoryName: true }) }));
    expect(prisma.gitHubEngineeringEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100, where: expect.objectContaining({ sha, repositoryOwner: "org", repositoryName: "repo" }) }));
  });
});
