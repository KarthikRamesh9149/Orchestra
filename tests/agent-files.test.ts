import { describe, expect, it, vi } from "vitest";
import { AGENT_MARKDOWN_TEMPLATE_VERSION, DEFAULT_AGENT_MARKDOWN_FILES } from "../src/modules/agent-files/default-files.js";
import { AgentFilesService } from "../src/modules/agent-files/service.js";

const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
const orgId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const fileSetId = "33333333-3333-4333-8333-333333333333";

function createHarness(env: any = { MVP_MODE: true, MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"] }) {
  const fileSets: any[] = [];
  const files: any[] = [];
  const versions: any[] = [];
  const syncRuns: any[] = [];
  const qualityReports: any[] = [];
  const driftReports: any[] = [];
  let productBrainId = "brain-v1";
  let productBrainVersionNumber = 1;
  let acceptedChangeSummary = "MCP is read-only by default.";

  const prisma = {
    project: {
      findUnique: vi.fn(async () => ({
        id: projectId,
        orgId,
        name: "Orchestra Backend",
        description: "Product Brain for humans and agents. OPENAI_API_KEY=sk-testsecret000000000000 DATABASE_URL=postgresql://example"
      }))
    },
    agentMarkdownFileSet: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: fileSetId, ...data, createdAt: new Date("2026-05-01T00:00:00.000Z"), updatedAt: new Date("2026-05-01T00:00:00.000Z"), archivedAt: null };
        fileSets.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = fileSets.find((item) => item.id === where.id || item.projectId === where.projectId);
        return row ? { ...row, files: files.filter((file) => file.fileSetId === row.id).sort((a, b) => a.generationOrder - b.generationOrder).map((file) => ({ ...file, versions: versions.filter((version) => version.fileId === file.id).sort((a, b) => b.versionNumber - a.versionNumber).slice(0, 1) })) } : null;
      }),
      findMany: vi.fn(async () => fileSets.map((row) => ({ ...row, files: files.filter((file) => file.fileSetId === row.id) }))),
      update: vi.fn(async ({ where, data }: any) => {
        const row = fileSets.find((item) => item.id === where.id);
        if (row) Object.assign(row, data, { updatedAt: new Date("2026-05-02T00:00:00.000Z") });
        return row;
      })
    },
    agentMarkdownFile: {
      createMany: vi.fn(async ({ data }: any) => {
        data.forEach((item: any, index: number) => files.push({ id: `37e6d602-cc1b-4cc9-bc6c-5547241fbf9${index}`, ...item, status: item.status ?? "active", createdAt: new Date("2026-05-01T00:00:00.000Z"), updatedAt: new Date("2026-05-01T00:00:00.000Z"), archivedAt: null }));
        return { count: data.length };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const file = files.find((item) => item.id === where.id && item.fileSetId === where.fileSetId);
        return file ? { ...file, versions: versions.filter((version) => version.fileId === file.id).sort((a, b) => b.versionNumber - a.versionNumber).slice(0, 1) } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const file = files.find((item) => item.id === where.id);
        if (file) Object.assign(file, data, { updatedAt: new Date("2026-05-04T00:00:00.000Z") });
        return file;
      })
    },
    agentMarkdownFileVersion: {
      findFirst: vi.fn(async ({ where }: any) => versions.filter((version) => version.fileId === where.fileId).sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `version-${versions.length + 1}`, ...data, createdAt: new Date("2026-05-03T00:00:00.000Z") };
        versions.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: any) => versions.filter((version) => version.fileId === where.fileId))
    },
    agentMarkdownSyncRun: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `sync-${syncRuns.length + 1}`, ...data, createdAt: new Date("2026-05-03T00:00:00.000Z") };
        syncRuns.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: any) => syncRuns.filter((row) => row.projectId === where.projectId && row.fileSetId === where.fileSetId)),
      findFirst: vi.fn(async ({ where }: any) => syncRuns.find((row) => row.id === where.id && row.projectId === where.projectId && row.fileSetId === where.fileSetId) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const row = syncRuns.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      })
    },
    agentMarkdownFileQualityReport: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `quality-${qualityReports.length + 1}`, ...data, createdAt: new Date("2026-05-05T00:00:00.000Z") };
        qualityReports.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) => qualityReports.filter((row) => row.projectId === where.projectId && row.fileSetId === where.fileSetId).at(-1) ?? null)
    },
    agentMarkdownFileDriftReport: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `drift-${driftReports.length + 1}`, ...data, createdAt: new Date("2026-05-05T00:00:00.000Z") };
        driftReports.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) => driftReports.filter((row) => row.projectId === where.projectId && row.fileSetId === where.fileSetId).at(-1) ?? null)
    },
    artifactVersion: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.artifactType === "product_brain"
          ? { id: productBrainId, projectId, artifactType: "product_brain", versionNumber: productBrainVersionNumber, status: "accepted", payloadJson: { mission: "Keep Product Brain current." }, changeSummary: "Accepted truth", createdAt: new Date("2026-05-01T00:00:00.000Z") }
          : { id: "live-v1", projectId, artifactType: "live_doc", versionNumber: 1, status: "accepted", payloadJson: { summary: "Live Doc current layer." }, changeSummary: "Current live doc", createdAt: new Date("2026-05-01T00:00:00.000Z") }
      )
    },
    brainNode: { findMany: vi.fn(async () => [{ id: "node-1", title: "Agent safety", summary: "Agents cannot mutate Product Brain.", status: "accepted", createdAt: new Date("2026-05-01T00:00:00.000Z") }]) },
    specChangeProposal: { findMany: vi.fn(async () => [{ id: "change-1", title: "Accepted MCP safety", summary: acceptedChangeSummary, status: "accepted", acceptedAt: new Date("2026-05-01T00:00:00.000Z") }]) },
    decisionRecord: { findMany: vi.fn(async () => [{ id: "decision-1", title: "Branch safety", statement: "Do not merge main into mvp-v0.", status: "accepted", acceptedAt: new Date("2026-05-01T00:00:00.000Z") }]) },
    projectCodingRequirements: { findMany: vi.fn(async () => [{ id: "coding-1", artifactVersionId: "coding-v1", artifactVersion: { payloadJson: { backend: "Project-scoped APIs only." } } }]) },
    projectDiagram: { findMany: vi.fn(async () => []) },
    projectResponsibility: { findMany: vi.fn(async () => []) },
    projectContextEntry: {
      findMany: vi.fn(async () => [
        {
          id: "ctx-1",
          title: "Manual note",
          body: "Do not guess open questions. OPENAI_API_KEY=sk-testsecret000000000000 DATABASE_URL=postgresql://example"
        }
      ])
    },
    communicationMessage: {
      findMany: vi.fn(async () => [
        { id: "slack-1", provider: "slack", bodyText: "hidden Slack text should not leak", sentAt: new Date("2026-05-01T00:00:00.000Z") },
        { id: "ff-1", provider: "fireflies_ai", bodyText: "Fireflies evidence says preserve citations.", sentAt: new Date("2026-05-01T00:00:00.000Z") },
        { id: "granola-1", provider: "granola", bodyText: "Granola evidence says scope changed in the kickoff note.", sentAt: new Date("2026-05-01T00:00:00.000Z") }
      ])
    },
    agentContextPack: { findMany: vi.fn(async () => [{ id: "pack-1", title: "MCP pack", taskPrompt: "Implement safely.", generatedAt: new Date("2026-05-01T00:00:00.000Z") }]) },
    agentRun: { findMany: vi.fn(async () => [{ id: "run-1", taskTitle: "Codex implementation", provider: "codex", status: "completed", branchName: "feature/x", humanReviewResult: "unreviewed", risksFoundJson: ["Needs tests"], followUpQuestionsJson: ["Should docs be updated?"], createdAt: new Date("2026-05-02T00:00:00.000Z") }]) },
    agentQualityReview: { findMany: vi.fn(async () => [{ id: "review-1", reviewType: "agent_run_review", scoreLabel: "usable_with_warnings", recommendation: "needs_human_review", summary: "Review aid only.", findingsJson: [{ type: "test_gap", severity: "high", summary: "Tests not recorded." }], openQuestionsJson: ["Verify tests."], carryForwardNotesJson: ["Do not treat review as truth."], createdAt: new Date("2026-05-03T00:00:00.000Z") }]) },
    dashboardSnapshot: { findFirst: vi.fn(async () => null) }
  };
  const projectService = { ensureProjectAccess: vi.fn(async () => ({ projectRole: "manager", isActive: true })) };
  const auditService = { record: vi.fn(async () => undefined) };
  const service = new AgentFilesService(
    prisma as any,
    env,
    projectService as any,
    auditService as any
  );
  return {
    service,
    prisma,
    auditService,
    fileSets,
    files,
    versions,
    syncRuns,
    qualityReports,
    driftReports,
    setProductBrainVersion: (id: string, versionNumber: number) => {
      productBrainId = id;
      productBrainVersionNumber = versionNumber;
    },
    setAcceptedChangeSummary: (summary: string) => {
      acceptedChangeSummary = summary;
    }
  };
}

describe("Product Brain Agent Files foundation", () => {
  it("defines exactly seven default generated Markdown files", () => {
    expect(DEFAULT_AGENT_MARKDOWN_FILES.map((file) => file.filePath)).toEqual([
      "AGENTS.md",
      "ORCHESTRA_CONTEXT.md",
      "docs/orchestra/PRODUCT_BRAIN.md",
      "docs/orchestra/CODING_REQUIREMENTS.md",
      "docs/orchestra/OPEN_QUESTIONS.md",
      "docs/orchestra/AGENT_MEMORY.md",
      "docs/orchestra/DRIFT_AND_REVIEW.md"
    ]);
  });

  it("previews MVP-safe generated files without persisting versions or leaking disabled providers", async () => {
    const { service, prisma, auditService, versions } = createHarness();
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    const preview = await service.previewFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });

    expect(preview.files).toHaveLength(7);
    expect(preview.files.find((file: any) => file.filePath === "AGENTS.md")?.contentMarkdown).toContain("Do not merge main into mvp-v0");
    expect(JSON.stringify(preview)).not.toContain("hidden Slack text");
    expect(JSON.stringify(preview)).not.toContain("sk-testsecret");
    expect(JSON.stringify(preview)).not.toContain("DATABASE_URL=");
    expect(preview.limitations).toEqual(expect.arrayContaining([expect.stringContaining("does not write to GitHub")]));
    expect(versions).toHaveLength(0);
    expect(prisma.agentMarkdownSyncRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mode: "preview" }) }));
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "agent_file.secret_like_content_redacted_or_blocked" }));
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "agent_file.previewed" }));
  });

  it("includes Slack evidence in MVP agent files when Slack is explicitly allowed", async () => {
    const { service } = createHarness({ MVP_MODE: true, MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai", "slack", "clickup"] });
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    const preview = await service.previewFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });

    expect(JSON.stringify(preview)).toContain("hidden Slack text should not leak");
  });

  it("includes Granola evidence in MVP agent files through the default provider profile", async () => {
    const { service } = createHarness({ MVP_MODE: true });
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    const preview = await service.previewFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });

    expect(JSON.stringify(preview)).toContain("Granola evidence says scope changed in the kickoff note.");
  });

  it("generates and persists one version for every default file with content hashes and truth warnings", async () => {
    const { service, versions } = createHarness();
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    const generated = await service.generateFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });

    expect(generated.files).toHaveLength(7);
    expect(versions).toHaveLength(7);
    expect(generated.noRepoWrite).toBe(true);
    expect(generated.files.every((file: any) => /^[a-f0-9]{64}$/.test(file.contentHash))).toBe(true);
    expect(generated.files.every((file: any) => file.contentMarkdown.includes("ORCHESTRA BEGIN generated"))).toBe(true);
    expect(generated.files.every((file: any) => file.contentMarkdown.includes("ORCHESTRA BEGIN manual-notes"))).toBe(true);
    expect(generated.files.find((file: any) => file.filePath.endsWith("AGENT_MEMORY.md"))?.contentMarkdown).toContain("implementation evidence, not Product Brain truth");
  });

  it("detects Product Brain staleness and refreshes stale files without repo writes", async () => {
    const { service, versions, setProductBrainVersion, auditService } = createHarness();
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    await service.generateFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });
    setProductBrainVersion("brain-v2", 2);

    const staleness = await service.getStaleness(projectId, fileSet.id, actorUserId);
    expect(staleness.staleFileCount).toBe(7);
    expect(JSON.stringify(staleness)).toContain("product_brain");

    const refreshed = await service.refreshFileSet(projectId, fileSet.id, actorUserId, { staleOnly: true });
    expect(refreshed.changedFiles).toHaveLength(7);
    expect(versions).toHaveLength(14);
    expect(refreshed.noRepoWrite).toBe(true);
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "agent_file.refreshed" }));
  });

  it("detects template and projection-content staleness without relying only on Product Brain IDs", async () => {
    const { service, fileSets, setAcceptedChangeSummary } = createHarness();
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    await service.generateFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });

    fileSets[0].defaultTemplateVersion = "legacy-template";
    setAcceptedChangeSummary("MCP is read-only by default and agent-file refresh must explain projection drift.");

    const staleness = await service.getStaleness(projectId, fileSet.id, actorUserId);
    expect(staleness.staleFileCount).toBe(7);
    expect(JSON.stringify(staleness)).toContain("template");
    expect(JSON.stringify(staleness)).toContain("projection_content");

    await service.refreshFileSet(projectId, fileSet.id, actorUserId, { staleOnly: true });
    expect(fileSets[0].defaultTemplateVersion).toBe(AGENT_MARKDOWN_TEMPLATE_VERSION);
  });

  it("returns deterministic manifest, diff, latest file, and download bundle contracts", async () => {
    const { service } = createHarness();
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    const generated = await service.generateFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });

    const manifest = await service.getManifest(projectId, fileSet.id, actorUserId);
    expect(manifest.files).toHaveLength(7);
    expect(manifest.noGitHubWrite).toBe(true);

    const diff = await service.getDiff(projectId, fileSet.id, actorUserId);
    expect(diff.summary.unchanged).toBe(7);

    const latest = await service.getLatestFile(projectId, fileSet.id, generated.files[0].fileId, actorUserId);
    expect(latest.latestVersion.contentMarkdown).toContain("ORCHESTRA BEGIN generated");

    const bundle = await service.downloadBundle(projectId, fileSet.id, actorUserId);
    expect(bundle.files.map((file: any) => file.path)).toEqual(
      expect.arrayContaining(["AGENTS.md", "manifest.json", "README_GENERATED_BY_ORCHESTRA.md"])
    );
    expect(bundle.noGitHubWrite).toBe(true);
  });

  it("records local CLI conflicts as sync metadata without mutating Product Brain truth", async () => {
    const { service, files, syncRuns } = createHarness();
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    const generated = await service.generateFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });
    const result = await service.reportConflict(projectId, fileSet.id, actorUserId, {
      fileId: generated.files[0].fileId,
      conflictType: "generated_zone_modified",
      markerStatus: "valid",
      localContentHash: "abc123",
      conflictSummary: "Local generated zone differs from latest Orchestra hash. ghp_123456789012345678901234567890123456"
    });

    expect(result.status).toBe("manual_conflict");
    expect(files.find((file) => file.id === generated.files[0].fileId)?.status).toBe("manual_conflict");
    expect(syncRuns.at(-1)?.mode).toBe("local_cli");
    expect(JSON.stringify(syncRuns.at(-1))).not.toContain("ghp_123456789012345678901234567890123456");
  });

  it("scores quality, detects generated-file drift, and blocks GitHub PR sync by default", async () => {
    const { service, qualityReports, driftReports, syncRuns, auditService } = createHarness();
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, { repoOwner: "KarthikRamesh9149", repoName: "orchestrav2" });
    await service.generateFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });

    const quality = await service.refreshQualityReport(projectId, fileSet.id, actorUserId, { includeEvidence: false });
    expect(quality.overallScore).toBeGreaterThan(0);
    expect(quality.readiness.noTruthMutation).toBe(true);
    expect(qualityReports).toHaveLength(1);

    const drift = await service.refreshDriftReport(projectId, fileSet.id, actorUserId, { includeEvidence: false, includeLowConfidenceFindings: true });
    expect(drift.noTruthMutation).toBe(true);
    expect(driftReports).toHaveLength(1);

    const readiness = await service.getGithubReadiness(projectId, fileSet.id, actorUserId);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(expect.arrayContaining([expect.stringContaining("FEATURE_AGENT_FILES_GITHUB_SYNC_ENABLED")]));

    const prSync = await service.syncGithubPr(projectId, fileSet.id, actorUserId, { dryRun: true, force: false });
    expect(prSync.githubWriteAttempted).toBe(false);
    expect(prSync.noAutoMerge).toBe(true);
    expect(prSync.noCodeFileWrite).toBe(true);
    expect(prSync.changedFiles.map((file: any) => file.filePath)).toEqual(
      expect.arrayContaining(["AGENTS.md", "docs/orchestra/manifest.json"])
    );
    expect(JSON.stringify(prSync.changedFiles)).not.toContain("package.json");
    expect(syncRuns.at(-1)?.mode).toBe("github_pr");
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "agent_file.github_sync_denied" }));

    const unsafePrSync = await service.syncGithubPr(projectId, fileSet.id, actorUserId, {
      dryRun: true,
      force: false,
      body: "Generated projection with leaked ghp_123456789012345678901234567890123456 token"
    });
    expect(unsafePrSync.status).toBe("blocked");
    expect(JSON.stringify(unsafePrSync)).not.toContain("ghp_123456789012345678901234567890123456");
    expect(JSON.stringify(syncRuns.at(-1))).not.toContain("ghp_123456789012345678901234567890123456");

    const metadataRun = await service.createSyncRun(projectId, fileSet.id, actorUserId, {
      mode: "local_cli",
      status: "completed",
      summary: { note: "local CLI saw mcp_123456789012345678901234567890 secret" },
      changedFiles: [{ filePath: "AGENTS.md", note: "Bearer 123456789012345678901234567890" }]
    });
    expect(JSON.stringify(metadataRun)).not.toContain("mcp_123456789012345678901234567890");
    expect(JSON.stringify(metadataRun)).not.toContain("Bearer 123456789012345678901234567890");
  });

  it("fails release gate when critical manual conflicts are present", async () => {
    const { service } = createHarness();
    const fileSet = await service.createDefaultFileSet(projectId, actorUserId, {});
    const generated = await service.generateFileSet(projectId, fileSet.id, actorUserId, { includeContent: true });
    await service.reportConflict(projectId, fileSet.id, actorUserId, {
      fileId: generated.files[0].fileId,
      conflictType: "missing_markers",
      markerStatus: "missing_markers",
      conflictSummary: "Local file lacks Orchestra markers."
    });

    const gate = await service.checkReleaseGate(projectId, fileSet.id, actorUserId);
    expect(gate.status).toBe("fail");
    expect(gate.noTruthMutation).toBe(true);
    expect(gate.noAutoMerge).toBe(true);
  });
});
