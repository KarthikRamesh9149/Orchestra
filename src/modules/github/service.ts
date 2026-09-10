import { createHash, createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";
import {
  isProviderReleaseValidated,
  PROVIDER_RELEASE_VALIDATION_REASON
} from "../../lib/integrations/provider-release.js";
import type { AuditService } from "../audit/service.js";
import type { ProjectService } from "../projects/service.js";
import {
  normalizeInstallation,
  normalizeRepository,
  normalizeWebhookEvidence,
  sanitizePayload,
  type NormalizedGitHubEvidence
} from "./normalizers.js";
import { verifyGitHubWebhookSignature } from "./signature.js";

const SUPPORTED_WEBHOOK_EVENTS = [
  "installation",
  "installation_repositories",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "push",
  "check_suite",
  "check_run",
  "deployment",
  "deployment_status",
  "issue_comment"
];

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const CODE_STATUS_BUNDLE_CACHE_TTL_MS = 60 * 1000;
const GITHUB_REQUEST_TIMEOUT_MS = 15_000;
const GITHUB_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const GITHUB_INCREMENTAL_BRANCH_LIMIT = 8;
const GITHUB_INCREMENTAL_PR_LIMIT = 5;
const GITHUB_INCREMENTAL_PR_DETAIL_LIMIT = 0;
const GITHUB_INCREMENTAL_PR_FILE_LIMIT = 12;
const GITHUB_INCREMENTAL_COMMIT_LIMIT = 5;
const GITHUB_INCREMENTAL_COMMIT_DETAIL_LIMIT = 0;
const codeStatusBundleCache = new Map<string, { storedAt: number; value: any }>();

const GITHUB_RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export async function fetchGitHubWithRetry(
  input: string,
  init: RequestInit,
  options: { maxAttempts?: number; sleep?: (milliseconds: number) => Promise<void> } = {}
) {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 3));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let response: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await fetch(input, init);
    if (!GITHUB_RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) return response;
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds * 1000, 0), 1000)
      : Math.min(100 * 2 ** (attempt - 1), 1000);
    await sleep(delayMs);
  }
  return response!;
}

function githubWarning(scope: string, error: unknown) {
  return `${scope} backfill skipped: ${error instanceof AppError ? error.message : "GitHub API request failed"}`;
}

type Actor = {
  userId: string;
  orgId: string;
};

type GitHubOAuthPurpose = "installation" | "user_link";

type LinkRepositoryInput = {
  installationId?: string;
  githubInstallationId?: string;
  githubRepositoryId: string;
  owner: string;
  name: string;
  fullName?: string;
  defaultBranch?: string;
  private: boolean;
  fork: boolean;
  htmlUrl?: string;
};

type BackfillInput = {
  repoLinkId?: string;
  dryRun: boolean;
  mode: "repository_metadata" | "incremental" | "full";
};

export class GitHubIntegrationService {
  private readonly installationTokenCache = new Map<string, { token: string; expiresAtMs: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  getReadiness(actor?: Actor) {
    const missingConfiguration = this.getMissingConfiguration();
    const releaseValidated = isProviderReleaseValidated(this.env, "github");
    const readiness = {
      enabled: this.env.GITHUB_INTEGRATION_ENABLED,
      configured: missingConfiguration.length === 0,
      releaseValidated,
      canConnect: this.env.GITHUB_INTEGRATION_ENABLED && missingConfiguration.length === 0 && releaseValidated,
      canSync: this.env.GITHUB_INTEGRATION_ENABLED && missingConfiguration.length === 0 && releaseValidated,
      missingConfiguration,
      webhooksEnabled: this.env.GITHUB_WEBHOOKS_ENABLED,
      backfillEnabled: this.env.GITHUB_BACKFILL_ENABLED,
      userLinkingEnabled: this.env.GITHUB_USER_LINKING_ENABLED,
      readOnlyMode: this.env.GITHUB_READ_ONLY_MODE,
      writeActionsEnabled: false,
      contentScanEnabled: false,
      supportedWebhookEvents: SUPPORTED_WEBHOOK_EVENTS,
      limits: {
        pageSize: this.env.GITHUB_SYNC_PAGE_SIZE,
        maxReposPerInstallation: this.env.GITHUB_SYNC_MAX_REPOS_PER_INSTALLATION,
        maxPrBackfill: this.env.GITHUB_SYNC_MAX_PR_BACKFILL,
        maxCommitBackfill: this.env.GITHUB_SYNC_MAX_COMMIT_BACKFILL,
        webhookMaxPayloadBytes: this.env.GITHUB_WEBHOOK_MAX_PAYLOAD_BYTES
      },
      truthModel: {
        githubDataIsEngineeringEvidence: true,
        productBrainMutationAllowed: false,
        liveDocMutationAllowed: false,
        proposalAcceptRejectAllowed: false,
        githubWritesAllowed: false,
        autoMergeAllowed: false
      },
      limitations: releaseValidated ? [] : [PROVIDER_RELEASE_VALIDATION_REASON]
    };

    if (actor) {
      void this.auditService.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        eventType: "github.readiness.checked",
        entityType: "github_integration",
        payload: {
          enabled: readiness.enabled,
          configured: readiness.configured,
          writeActionsEnabled: false,
          contentScanEnabled: false
        }
      });
    }

    return readiness;
  }

  async getInstallUrl(actor: Actor) {
    this.assertReleaseValidated();
    this.assertIntegrationEnabled();
    await this.ensureGitHubInstallationAdmin(actor);
    const installUrl = await this.buildInstallUrl(actor);
    void this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "github.installation.install_url_requested",
      entityType: "github_installation",
      payload: { configured: Boolean(installUrl), readOnlyMode: true }
    });
    return {
      enabled: true,
      installUrl,
      callbackUrl: this.env.GITHUB_APP_CALLBACK_URL ?? null,
      readOnlyMode: true,
      writeActionsEnabled: false,
      message: this.env.GITHUB_APP_SETUP_URL
        ? "Install the Orchestra GitHub App on selected repositories."
        : "GITHUB_APP_SETUP_URL is not configured."
    };
  }

  async handleInstallationCallbackFromState(input: { installationId: string; setupAction?: string; state?: string }) {
    this.assertReleaseValidated();
    const actor = await this.consumeInstallState(input.state);
    return this.handleInstallationCallback(actor, input);
  }

  async handleInstallationCallback(actor: Actor, input: { installationId: string; setupAction?: string; state?: string }) {
    this.assertReleaseValidated();
    this.assertIntegrationEnabled();
    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "github.installation.callback_received",
      entityType: "github_installation",
      payload: { githubInstallationId: input.installationId, setupAction: input.setupAction ?? null }
    });

    const installationPayload = await this.resolveInstallationPayload(input.installationId);
    const normalized = normalizeInstallation(installationPayload);
    if (normalized.githubInstallationId === "unknown") {
      throw new AppError(502, "GitHub installation identity was missing", "github_installation_identity_missing");
    }
    if (normalized.githubAccountLogin) this.assertOwnerAllowed(normalized.githubAccountLogin);
    const existing = await this.prisma.gitHubInstallation.findUnique({
      where: { githubInstallationId: normalized.githubInstallationId }
    });
    if (existing && existing.orgId !== actor.orgId) {
      throw new AppError(409, "GitHub installation is already claimed", "github_installation_already_claimed");
    }
    const createData = {
        orgId: actor.orgId,
        githubInstallationId: normalized.githubInstallationId,
        githubAccountId: normalized.githubAccountId,
        githubAccountLogin: normalized.githubAccountLogin,
        githubAccountType: normalized.githubAccountType,
        repositorySelection: normalized.repositorySelection,
        permissionsJson: normalized.permissions as Prisma.InputJsonValue,
        eventsJson: normalized.events as Prisma.InputJsonValue,
        status: normalized.suspendedAt ? "suspended" : input.setupAction === "request" ? "pending" : "active",
        installedAt: normalized.installedAt ?? new Date()
      } as const;
    const updateData = {
        githubAccountId: normalized.githubAccountId,
        githubAccountLogin: normalized.githubAccountLogin,
        githubAccountType: normalized.githubAccountType,
        repositorySelection: normalized.repositorySelection,
        permissionsJson: normalized.permissions as Prisma.InputJsonValue,
        eventsJson: normalized.events as Prisma.InputJsonValue,
        status: normalized.suspendedAt ? "suspended" : input.setupAction === "request" ? "pending" : "active",
        archivedAt: null,
        suspendedAt: normalized.suspendedAt,
        installedAt: normalized.installedAt ?? new Date()
      } as const;
    let installation;
    if (existing) {
      installation = await this.prisma.gitHubInstallation.update({ where: { id: existing.id }, data: updateData });
    } else {
      try {
        installation = await this.prisma.gitHubInstallation.create({ data: createData });
      } catch (error) {
        const code = typeof error === "object" && error ? (error as { code?: unknown }).code : null;
        if (code !== "P2002") throw error;
        const raced = await this.prisma.gitHubInstallation.findUnique({ where: { githubInstallationId: normalized.githubInstallationId } });
        if (!raced || raced.orgId !== actor.orgId) {
          throw new AppError(409, "GitHub installation is already claimed", "github_installation_already_claimed");
        }
        installation = await this.prisma.gitHubInstallation.update({ where: { id: raced.id }, data: updateData });
      }
    }

    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "github.installation.updated",
      entityType: "github_installation",
      entityId: installation.id,
      payload: { githubInstallationId: installation.githubInstallationId, status: installation.status }
    });

    return this.toInstallationDto(installation);
  }

  async listInstallations(actor: Actor) {
    this.assertIntegrationEnabled();
    const rows = await this.prisma.gitHubInstallation.findMany({
      where: { orgId: actor.orgId, archivedAt: null },
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((row) => this.toInstallationDto(row));
  }

  async listInstallationRepositories(actor: Actor, installationId: string) {
    this.assertReleaseValidated();
    this.assertIntegrationEnabled();
    const installation = await this.getInstallationById(actor.orgId, installationId);
    await this.refreshInstallationRepositories(installation);
    const rows = await this.prisma.gitHubRepository.findMany({
      where: { orgId: actor.orgId, installationId: installation.id, archivedAt: null },
      orderBy: [{ owner: "asc" }, { name: "asc" }]
    });
    return rows.map((row) => this.toRepositoryDto(row));
  }

  async linkRepository(projectId: string, actor: Actor, input: LinkRepositoryInput) {
    this.assertReleaseValidated();
    this.assertIntegrationEnabled();
    await this.projectService.ensureProjectManager(projectId, actor.userId);
    this.assertOwnerAllowed(input.owner);

    const project = await this.prisma.project.findFirstOrThrow({
      where: { id: projectId, orgId: actor.orgId },
      select: { id: true, orgId: true }
    });
    const installation = input.installationId
      ? await this.getInstallationById(actor.orgId, input.installationId)
      : await this.getInstallationByGitHubId(actor.orgId, input.githubInstallationId!);
    const verifiedRepository = await this.resolveRepositoryForInstallation(installation, input);
    this.assertOwnerAllowed(verifiedRepository.owner);

    const repository = await this.prisma.gitHubRepository.upsert({
      where: {
        installationId_githubRepositoryId: {
          installationId: installation.id,
          githubRepositoryId: verifiedRepository.githubRepositoryId
        }
      },
      create: {
        orgId: actor.orgId,
        installationId: installation.id,
        githubRepositoryId: verifiedRepository.githubRepositoryId,
        owner: verifiedRepository.owner,
        name: verifiedRepository.name,
        fullName: verifiedRepository.fullName,
        defaultBranch: verifiedRepository.defaultBranch,
        private: verifiedRepository.private,
        fork: verifiedRepository.fork,
        htmlUrl: verifiedRepository.htmlUrl,
        status: "active"
      },
      update: {
        owner: verifiedRepository.owner,
        name: verifiedRepository.name,
        fullName: verifiedRepository.fullName,
        defaultBranch: verifiedRepository.defaultBranch,
        private: verifiedRepository.private,
        fork: verifiedRepository.fork,
        htmlUrl: verifiedRepository.htmlUrl,
        status: "active",
        archivedAt: null
      }
    });

    const link = await this.prisma.gitHubRepositoryProjectLink.upsert({
      where: {
        projectId_repositoryId: {
          projectId: project.id,
          repositoryId: repository.id
        }
      },
      create: {
        orgId: actor.orgId,
        projectId: project.id,
        installationId: installation.id,
        repositoryId: repository.id,
        linkedByUserId: actor.userId,
        status: "active"
      },
      update: {
        status: "active",
        archivedAt: null,
        linkedByUserId: actor.userId
      },
      include: { repository: true, installation: true }
    });

    await this.writeEvidenceForRepository(link.id, project.id, actor.orgId, installation.id, repository.id, repository);
    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "github.repository.linked_to_project",
      entityType: "github_repository_project_link",
      entityId: link.id,
      payload: {
        installationId: installation.id,
        repositoryId: repository.id,
        repository: repository.fullName,
        readOnlyMode: true,
        writeActionsEnabled: false
      }
    });

    this.invalidateCodeStatusBundleCache(projectId);
    return this.toRepositoryLinkDto(link);
  }

  async getProjectIntegration(projectId: string, actor: Actor) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    const [links, syncRuns] = await Promise.all([
      this.prisma.gitHubRepositoryProjectLink.findMany({
        where: { orgId: actor.orgId, projectId, archivedAt: null },
        include: { repository: true, installation: true },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.gitHubSyncRun.findMany({
        where: { orgId: actor.orgId, projectId },
        orderBy: { createdAt: "desc" },
        take: 5
      })
    ]);

    return {
      readiness: this.getReadiness(),
      projectId,
      readOnlyMode: true,
      writeActionsEnabled: false,
      linkedRepositories: links.map((link) => this.toRepositoryLinkDto(link)),
      latestSyncRuns: syncRuns.map((run) => this.toSyncRunDto(run)),
      truthModel: {
        githubDataIsEngineeringEvidence: true,
        productBrainMutationAllowed: false,
        liveDocMutationAllowed: false,
        proposalAcceptRejectAllowed: false
      }
    };
  }

  async getCodeStatus(projectId: string, actor: Actor) {
    const bundle = await this.getCodeStatusBundle(projectId, actor);
    return bundle.status;
  }

  async getCodeStatusBundle(projectId: string, actor: Actor) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    const cacheKey = this.codeStatusBundleCacheKey(projectId, actor);
    const cached = codeStatusBundleCache.get(cacheKey);
    if (cached && Date.now() - cached.storedAt < CODE_STATUS_BUNDLE_CACHE_TTL_MS) {
      return cached.value;
    }
    const evidence = await this.loadCodeStatusEvidence(projectId, actor);
    const bundle = this.toCodeStatusBundle(projectId, actor, evidence);
    codeStatusBundleCache.set(cacheKey, { storedAt: Date.now(), value: bundle });
    this.pruneCodeStatusBundleCache();
    return bundle;
  }

  async listCodePullRequests(projectId: string, actor: Actor) {
    const bundle = await this.getCodeStatusBundle(projectId, actor);
    return bundle.pullRequests;
  }

  async listCodeConflicts(projectId: string, actor: Actor) {
    const bundle = await this.getCodeStatusBundle(projectId, actor);
    return bundle.conflicts;
  }

  async listCodeActivity(projectId: string, actor: Actor) {
    const bundle = await this.getCodeStatusBundle(projectId, actor);
    return bundle.activity;
  }

  async listCodeBranches(projectId: string, actor: Actor) {
    const bundle = await this.getCodeStatusBundle(projectId, actor);
    return bundle.branches;
  }

  async archiveRepositoryLink(projectId: string, repoLinkId: string, actor: Actor) {
    await this.projectService.ensureProjectManager(projectId, actor.userId);
    const link = await this.prisma.gitHubRepositoryProjectLink.findFirst({
      where: { id: repoLinkId, projectId, orgId: actor.orgId, archivedAt: null },
      include: { repository: true }
    });
    if (!link) {
      throw new AppError(404, "GitHub repository link not found", "github_repository_link_not_found");
    }

    const archivedAt = new Date();
    const archived = await this.prisma.$transaction(async (tx) => {
      const archivedLink = await tx.gitHubRepositoryProjectLink.update({
        where: { id: link.id },
        data: { status: "archived", archivedAt },
        include: { repository: true, installation: true }
      });
      await tx.gitHubEngineeringEvidence.updateMany({
        where: { orgId: actor.orgId, projectId, repositoryLinkId: link.id, evidenceStatus: "active" },
        data: { evidenceStatus: "archived" }
      });
      return archivedLink;
    });
    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "github.repository.unlinked_from_project",
      entityType: "github_repository_project_link",
      entityId: archived.id,
      payload: { repository: link.repository.fullName }
    });
    this.invalidateCodeStatusBundleCache(projectId);
    return this.toRepositoryLinkDto(archived);
  }

  async triggerBackfill(projectId: string, actor: Actor, input: BackfillInput) {
    this.assertReleaseValidated();
    this.assertIntegrationEnabled();
    await this.projectService.ensureProjectManager(projectId, actor.userId);
    const link = input.repoLinkId
      ? await this.prisma.gitHubRepositoryProjectLink.findFirst({
          where: { id: input.repoLinkId, projectId, orgId: actor.orgId, archivedAt: null },
          include: { repository: true, installation: true }
        })
      : await this.prisma.gitHubRepositoryProjectLink.findFirst({
          where: { projectId, orgId: actor.orgId, archivedAt: null },
          include: { repository: true, installation: true },
          orderBy: { updatedAt: "desc" }
        });

    if (!link) {
      throw new AppError(404, "No linked GitHub repository found", "github_repository_link_not_found");
    }

    const syncRun = await this.prisma.gitHubSyncRun.create({
      data: {
        orgId: actor.orgId,
        projectId,
        installationId: link.installationId,
        repositoryLinkId: link.id,
        mode: input.mode,
        status: "running",
        startedByUserId: actor.userId
      }
    });
    this.invalidateCodeStatusBundleCache(projectId);

    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "github.backfill.started",
      entityType: "github_sync_run",
      entityId: syncRun.id,
      payload: { repoLinkId: link.id, dryRun: input.dryRun, mode: input.mode, readOnlyMode: true }
    });
    let completedRun = syncRun;
    try {
      const result =
        this.env.GITHUB_BACKFILL_ENABLED && !input.dryRun
          ? await this.runReadOnlyBackfill(link, input)
          : {
              counts: { repositories: 1, evidenceItems: 1 },
              warnings: ["Dry-run backfill recorded readiness only; no GitHub API was called."]
            };
      completedRun = await this.prisma.gitHubSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: result.warnings.length > 0 ? "completed_with_warnings" : "completed",
          finishedAt: new Date(),
          countsJson: result.counts,
          warningsJson: result.warnings
        }
      });
    } catch (error) {
      const message = redactAndLimit(error instanceof Error ? error.message : "GitHub backfill failed", 500);
      completedRun = await this.prisma.gitHubSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errorsJson: [{ message }]
        }
      });
      await this.auditService.record({
        orgId: actor.orgId,
        projectId,
        actorUserId: actor.userId,
        eventType: "github.backfill.failed",
        entityType: "github_sync_run",
        entityId: syncRun.id,
        payload: { repoLinkId: link.id, error: redactAndLimit(message, 200) }
      });
      this.invalidateCodeStatusBundleCache(projectId);
      throw new AppError(502, "GitHub read-only backfill failed", "github_backfill_failed");
    }
    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "github.backfill.completed",
      entityType: "github_sync_run",
      entityId: completedRun.id,
      payload: { repoLinkId: link.id, status: completedRun.status, writeActionsEnabled: false }
    });
    this.invalidateCodeStatusBundleCache(projectId);
    return this.toSyncRunDto(completedRun);
  }

  async listSyncRuns(projectId: string, actor: Actor, limit: number) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    const runs = await this.prisma.gitHubSyncRun.findMany({
      where: { orgId: actor.orgId, projectId },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return runs.map((run) => this.toSyncRunDto(run));
  }

  async getUserLinkStatus(actor: Actor) {
    const link = await this.prisma.gitHubUserLink.findFirst({
      where: { orgId: actor.orgId, userId: actor.userId, status: "active" },
      orderBy: { linkedAt: "desc" }
    });
    return link ? this.toUserLinkDto(link) : { linked: false, userId: actor.userId };
  }

  async getUserLinkStart(actor: Actor) {
    this.assertReleaseValidated();
    if (!this.env.GITHUB_USER_LINKING_ENABLED) {
      throw new AppError(403, "GitHub user linking is disabled", "github_user_linking_disabled");
    }
    const state = await this.buildUserLinkState(actor);
    const url = this.env.GITHUB_APP_CLIENT_ID
      ? new URL("https://github.com/login/oauth/authorize")
      : null;
    if (url) {
      url.searchParams.set("client_id", this.env.GITHUB_APP_CLIENT_ID!);
      url.searchParams.set("state", state);
      url.searchParams.set("scope", "read:user user:email");
      if (this.env.GITHUB_APP_CALLBACK_URL) {
        url.searchParams.set("redirect_uri", this.env.GITHUB_APP_CALLBACK_URL);
      }
    }
    void this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "github.user_link.started",
      entityType: "github_user_link",
      payload: { configured: Boolean(url), tokenStored: false }
    });
    return { authorizationUrl: url?.toString() ?? null, state, tokenStored: false };
  }

  async handleUserLinkCallback(
    actor: Actor,
    input: { state?: string; code?: string; githubUserId?: string; githubLogin?: string; githubAvatarUrl?: string; githubEmail?: string }
  ) {
    this.assertReleaseValidated();
    if (!this.env.GITHUB_USER_LINKING_ENABLED) {
      throw new AppError(403, "GitHub user linking is disabled", "github_user_linking_disabled");
    }
    const stateActor = await this.consumeUserLinkState(input.state, actor);
    const identity =
      input.githubUserId && input.githubLogin && this.allowMockGitHubApi()
        ? {
            githubUserId: input.githubUserId,
            githubLogin: input.githubLogin,
            githubAvatarUrl: input.githubAvatarUrl ?? null,
            githubEmailHash: input.githubEmail ? hashEmail(input.githubEmail) : null
          }
          : input.githubUserId || input.githubLogin
            ? null
            : input.code
          ? await this.exchangeUserCodeForIdentity(input.code)
          : null;

    if (!identity) {
      throw new AppError(
        400,
        "GitHub identity callback requires OAuth code exchange outside test mode",
        "github_user_identity_missing"
      );
    }

    const link = await this.prisma.gitHubUserLink.upsert({
      where: {
        orgId_userId_githubUserId: {
          orgId: actor.orgId,
          userId: actor.userId,
          githubUserId: identity.githubUserId
        }
      },
      create: {
        orgId: actor.orgId,
        userId: actor.userId,
        githubUserId: identity.githubUserId,
        githubLogin: identity.githubLogin,
        githubAvatarUrl: identity.githubAvatarUrl,
        githubEmailHash: identity.githubEmailHash,
        status: "active",
        lastSeenAt: new Date()
      },
      update: {
        githubLogin: identity.githubLogin,
        githubAvatarUrl: identity.githubAvatarUrl,
        githubEmailHash: identity.githubEmailHash,
        status: "active",
        revokedAt: null,
        lastSeenAt: new Date()
      }
    });

    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "github.user_link.completed",
      entityType: "github_user_link",
      entityId: link.id,
      payload: { githubUserId: link.githubUserId, githubLogin: link.githubLogin, tokenStored: false }
    });
    return this.toUserLinkDto(link);
  }

  async revokeUserLink(actor: Actor) {
    const link = await this.prisma.gitHubUserLink.findFirst({
      where: { orgId: actor.orgId, userId: actor.userId, status: "active" },
      orderBy: { linkedAt: "desc" }
    });
    if (!link) {
      return { linked: false, revoked: false };
    }
    const revoked = await this.prisma.gitHubUserLink.update({
      where: { id: link.id },
      data: { status: "revoked", revokedAt: new Date() }
    });
    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "github.user_link.revoked",
      entityType: "github_user_link",
      entityId: revoked.id,
      payload: { githubLogin: revoked.githubLogin }
    });
    return { ...this.toUserLinkDto(revoked), revoked: true };
  }

  async handleWebhook(input: { headers: IncomingHttpHeaders; rawBody: string; body: unknown }) {
    this.assertReleaseValidated();
    if (!this.env.GITHUB_WEBHOOKS_ENABLED) {
      throw new AppError(403, "GitHub webhooks are disabled", "github_webhooks_disabled");
    }
    if (!this.env.GITHUB_APP_WEBHOOK_SECRET) {
      throw new AppError(503, "GitHub webhook secret is not configured", "github_webhook_secret_missing");
    }
    const rawBytes = Buffer.byteLength(input.rawBody, "utf8");
    if (rawBytes > this.env.GITHUB_WEBHOOK_MAX_PAYLOAD_BYTES) {
      throw new AppError(413, "GitHub webhook payload too large", "github_webhook_payload_too_large");
    }

    const deliveryId = getHeader(input.headers, "x-github-delivery");
    const eventType = getHeader(input.headers, "x-github-event");
    const signature = getHeader(input.headers, "x-hub-signature-256");
    if (!deliveryId || !eventType) {
      throw new AppError(400, "GitHub webhook missing delivery or event header", "github_webhook_headers_missing");
    }
    if (!verifyGitHubWebhookSignature(input.rawBody, signature, this.env.GITHUB_APP_WEBHOOK_SECRET)) {
      throw new AppError(401, "Invalid GitHub webhook signature", "github_webhook_invalid_signature");
    }

    const body = asRecord(input.body);
    const installationPayload = normalizeInstallation(input.body);
    const githubInstallationId = installationPayload.githubInstallationId;
    const repositoryPayload = body.repository ? normalizeRepository(body.repository) : null;
    const installation = githubInstallationId !== "unknown"
      ? await this.prisma.gitHubInstallation.findFirst({
          where: { githubInstallationId, archivedAt: null }
        })
      : null;
    const repository = installation && repositoryPayload
      ? await this.prisma.gitHubRepository.findFirst({
          where: {
            installationId: installation.id,
            githubRepositoryId: repositoryPayload.githubRepositoryId
          }
        })
      : null;
    const repositoryLinks = repository
      ? await this.prisma.gitHubRepositoryProjectLink.findMany({
          where: { repositoryId: repository.id, archivedAt: null, status: "active", installation: { status: "active", archivedAt: null }, repository: { status: "active", archivedAt: null } },
          orderBy: { updatedAt: "desc" },
          take: 25
        })
      : [];
    const repositoryLink = repositoryLinks[0] ?? null;

    const existing = await this.prisma.gitHubWebhookEvent.findFirst({
      where: { githubDeliveryId: deliveryId, eventType, installationId: installation?.id ?? null }
    });
    if (existing && ["processed", "ignored"].includes(existing.status)) {
      return { status: "duplicate", deliveryId, eventType };
    }
    const lease = `processing:${randomBytes(16).toString("hex")}`;
    if (existing) {
      const claimed = await this.prisma.gitHubWebhookEvent.updateMany({
        where: { id: existing.id, updatedAt: existing.updatedAt,
          OR: [{ status: { in: ["failed", "duplicate"] } }, { status: { in: ["received", "queued"] }, updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }] },
        data: { status: "queued", processedAt: null, errorMessage: lease }
      });
      if (claimed.count !== 1) throw new AppError(503, "This delivery is already processing; retry later", "github_delivery_processing");
    }
    const webhookEvent = existing ?? await this.prisma.gitHubWebhookEvent.create({
      data: {
        orgId: installation?.orgId ?? repositoryLink?.orgId ?? null,
        installationId: installation?.id ?? null,
        repositoryId: repository?.id ?? null,
        repositoryLinkId: repositoryLink?.id ?? null,
        githubDeliveryId: deliveryId,
        eventType,
        action: typeof body.action === "string" ? body.action : null,
        status: "queued",
        errorMessage: lease,
        payloadJson: this.toSafeWebhookPayload(input.body) as Prisma.InputJsonValue
      }
    });

    if (!SUPPORTED_WEBHOOK_EVENTS.includes(eventType)) {
      await this.prisma.gitHubWebhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: "ignored", processedAt: new Date(), errorMessage: null }
      });
      return { status: "ignored", deliveryId, eventType };
    }

    try {
      await this.processWebhookEvent(eventType, input.body, {
        installation,
        repository,
        repositoryLinks,
        webhookEventId: webhookEvent.id,
        lease
      });
      const outcome = repositoryLink || ["installation", "installation_repositories"].includes(eventType) ? "processed" : "ignored";
      const completed = await this.prisma.gitHubWebhookEvent.updateMany({
        where: { id: webhookEvent.id, status: "queued", errorMessage: lease },
        data: { status: outcome, processedAt: new Date(), errorMessage: null }
      });
      if (completed.count !== 1) throw new AppError(503, "Delivery lease expired; retry to reconcile", "github_delivery_lease_lost");
      const processed = { ...webhookEvent, status: outcome };
      if (processed.orgId) {
        await this.auditService.record({
          orgId: processed.orgId,
          projectId: repositoryLinks.length === 1 ? repositoryLinks[0].projectId : null,
          eventType: "github.webhook.processed",
          entityType: "github_webhook_event",
          entityId: processed.id,
          payload: { eventType, deliveryId, repositoryLinked: repositoryLinks.length > 0, linkedProjectCount: repositoryLinks.length }
        });
      }
      return { status: processed.status, deliveryId, eventType };
    } catch (error) {
      const message = redactAndLimit(error instanceof Error ? error.message : "Webhook processing failed", 500);
      await this.prisma.gitHubWebhookEvent.updateMany({
        where: { id: webhookEvent.id, status: "queued", errorMessage: lease },
        data: { status: "failed", errorMessage: message, processedAt: new Date() }
      });
      throw new AppError(500, "GitHub webhook processing failed", "github_webhook_processing_failed");
    }
  }

  assertWriteActionDenied(action: string) {
    throw new AppError(403, `GitHub write action is disabled for Feature 13 Part 1: ${action}`, "github_write_action_disabled");
  }

  private async processWebhookEvent(
    eventType: string,
    payload: unknown,
    context: {
      installation: { id: string; orgId: string } | null;
      repository: { id: string; githubRepositoryId: string; owner: string; name: string; fullName: string; htmlUrl: string | null } | null;
      repositoryLinks: Array<{ id: string; orgId: string; projectId: string; installationId: string; repositoryId: string }>;
      webhookEventId: string;
      lease: string;
    }
  ) {
    if (eventType === "installation") {
      await this.upsertInstallationFromPayload(payload, context.installation?.orgId);
      return;
    }
    if (eventType === "installation_repositories") {
      await this.upsertInstallationRepositoriesFromPayload(payload, context.installation);
      return;
    }
    if (context.repositoryLinks.length === 0 || !context.repository) {
      return;
    }
    const normalized = normalizeWebhookEvidence(eventType, payload);
    for (const link of context.repositoryLinks) {
      for (const item of normalized) {
        const heartbeat = await this.prisma.gitHubWebhookEvent.updateMany({ where: { id: context.webhookEventId, status: "queued", errorMessage: context.lease }, data: { updatedAt: new Date() } });
        if (heartbeat.count !== 1) throw new AppError(503, "Delivery ownership changed", "github_delivery_lease_lost");
        await this.writeEvidence(link, context.repository, item);
      }
    }
  }

  private async upsertInstallationFromPayload(payload: unknown, fallbackOrgId?: string) {
    const normalized = normalizeInstallation(payload);
    const orgId = fallbackOrgId;
    if (!orgId || normalized.githubInstallationId === "unknown") return;
    if (asRecord(payload).action === "deleted") {
      const installation = await this.prisma.gitHubInstallation.findUnique({ where: { githubInstallationId: normalized.githubInstallationId } });
      if (!installation || installation.orgId !== orgId) return;
      await this.revokeRepositoryAccess(installation.id);
      await this.prisma.gitHubInstallation.update({ where: { id: installation.id }, data: { status: "revoked", archivedAt: new Date() } });
      this.installationTokenCache.delete(normalized.githubInstallationId);
      return;
    }
    await this.prisma.gitHubInstallation.upsert({
      where: { githubInstallationId: normalized.githubInstallationId },
      create: {
        orgId,
        githubInstallationId: normalized.githubInstallationId,
        githubAccountId: normalized.githubAccountId,
        githubAccountLogin: normalized.githubAccountLogin,
        githubAccountType: normalized.githubAccountType,
        repositorySelection: normalized.repositorySelection,
        permissionsJson: normalized.permissions as Prisma.InputJsonValue,
        eventsJson: normalized.events as Prisma.InputJsonValue,
        status: normalized.suspendedAt ? "suspended" : "active",
        installedAt: normalized.installedAt
      },
      update: {
        githubAccountId: normalized.githubAccountId,
        githubAccountLogin: normalized.githubAccountLogin,
        githubAccountType: normalized.githubAccountType,
        repositorySelection: normalized.repositorySelection,
        permissionsJson: normalized.permissions as Prisma.InputJsonValue,
        eventsJson: normalized.events as Prisma.InputJsonValue,
        status: normalized.suspendedAt ? "suspended" : "active",
        suspendedAt: normalized.suspendedAt
      }
    });
  }

  private async upsertInstallationRepositoriesFromPayload(
    payload: unknown,
    installation: { id: string; orgId: string } | null
  ) {
    if (!installation) return;
    const body = asRecord(payload);
    for (const removed of Array.isArray(body.repositories_removed) ? body.repositories_removed : []) {
      const normalized = normalizeRepository(removed);
      const repository = await this.prisma.gitHubRepository.findFirst({ where: { installationId: installation.id, githubRepositoryId: normalized.githubRepositoryId } });
      if (repository) await this.revokeRepositoryAccess(installation.id, repository.id);
    }
    const repositories = [
      ...(Array.isArray(body.repositories_added) ? body.repositories_added : []),
      ...(Array.isArray(body.repositories) ? body.repositories : [])
    ];
    for (const repositoryPayload of repositories) {
      const repository = normalizeRepository(repositoryPayload);
      if (repository.githubRepositoryId === "unknown") continue;
      await this.prisma.gitHubRepository.upsert({
        where: {
          installationId_githubRepositoryId: {
            installationId: installation.id,
            githubRepositoryId: repository.githubRepositoryId
          }
        },
        create: {
          orgId: installation.orgId,
          installationId: installation.id,
          githubRepositoryId: repository.githubRepositoryId,
          owner: repository.owner,
          name: repository.name,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          private: repository.private,
          fork: repository.fork,
          htmlUrl: repository.htmlUrl,
          status: "active"
        },
        update: {
          owner: repository.owner,
          name: repository.name,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          private: repository.private,
          fork: repository.fork,
          htmlUrl: repository.htmlUrl,
          status: "active",
          archivedAt: null
        }
      });
    }
  }

  private async revokeRepositoryAccess(installationId: string, repositoryId?: string) {
    const where = { installationId, ...(repositoryId ? { repositoryId } : {}) };
    const links = await this.prisma.gitHubRepositoryProjectLink.findMany({ where });
    const archivedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.gitHubRepositoryProjectLink.updateMany({ where, data: { status: "revoked", archivedAt } });
      await tx.gitHubRepository.updateMany({ where: { installationId, ...(repositoryId ? { id: repositoryId } : {}) }, data: { status: "revoked", archivedAt } });
      // Retain historical rows for audit, but exclude revoked sources from current evidence.
      await tx.gitHubEngineeringEvidence.updateMany({ where, data: { evidenceStatus: "archived" } });
      await tx.engineeringEvidenceItem.updateMany({ where: { repositoryLinkId: { in: links.map((link) => link.id) } }, data: { archivedAt } });
    });
    for (const link of links) this.invalidateCodeStatusBundleCache(link.projectId);
    this.installationTokenCache.clear();
  }

  private async writeEvidence(
    link: { id: string; orgId: string; projectId: string; installationId: string; repositoryId: string },
    repository: { githubRepositoryId: string; owner: string; name: string; fullName: string; htmlUrl: string | null },
    item: NormalizedGitHubEvidence
  ) {
    const mappedUser = await this.findMappedUser(link.orgId, item.actorGithubUserId, item.actorGithubLogin);
    return this.prisma.$transaction(async (tx) => {
    // Serialize ingestion against revocation; a late webhook cannot resurrect
    // evidence after the repository link was revoked by another API instance.
    const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM github_repository_project_links WHERE id = ${link.id}::uuid AND status = 'active' AND archived_at IS NULL FOR UPDATE`;
    if (!active.length) return;
    const key = { repositoryLinkId: link.id, evidenceType: item.evidenceType, providerId: item.providerId };
    await tx.gitHubEngineeringEvidence.upsert({
      where: {
        repositoryLinkId_evidenceType_providerId: {
          repositoryLinkId: link.id,
          evidenceType: item.evidenceType,
          providerId: item.providerId
        }
      },
      create: {
        orgId: link.orgId,
        projectId: link.projectId,
        installationId: link.installationId,
        repositoryId: link.repositoryId,
        repositoryLinkId: link.id,
        githubRepositoryId: repository.githubRepositoryId,
        repositoryOwner: repository.owner,
        repositoryName: repository.name,
        evidenceType: item.evidenceType,
        providerId: item.providerId,
        title: item.title ?? null,
        summary: item.summary ?? null,
        branch: item.branch ?? null,
        sha: item.sha ?? null,
        pullRequestNumber: item.pullRequestNumber ?? null,
        path: item.path ?? null,
        status: item.status ?? null,
        actorGithubUserId: item.actorGithubUserId ?? null,
        actorGithubLogin: item.actorGithubLogin ?? null,
        mappedUserId: mappedUser?.userId ?? null,
        sourceUrl: item.sourceUrl ?? null,
        occurredAt: item.occurredAt ?? null,
        payloadJson: item.payload as Prisma.InputJsonValue,
        citationJson: {
          source: "github",
          evidenceType: item.evidenceType,
          providerId: item.providerId,
          repository: repository.fullName
        },
        openTargetJson: {
          type: item.evidenceType,
          url: item.sourceUrl ?? repository.htmlUrl,
          repository: repository.fullName
        }
      },
      update: {}
    });
    // Current projection only advances with a strictly newer provider timestamp.
    // Equal/unknown versions cannot overwrite verified conclusions on redelivery.
    if (!item.occurredAt) return;
    await tx.gitHubEngineeringEvidence.updateMany({
      where: { ...key, OR: [{ occurredAt: null }, { occurredAt: { lt: item.occurredAt } }] },
      data: {
        title: item.title ?? null,
        summary: item.summary ?? null,
        branch: item.branch ?? null,
        sha: item.sha ?? null,
        pullRequestNumber: item.pullRequestNumber ?? null,
        path: item.path ?? null,
        status: item.status ?? null,
        actorGithubUserId: item.actorGithubUserId ?? null,
        actorGithubLogin: item.actorGithubLogin ?? null,
        mappedUserId: mappedUser?.userId ?? null,
        sourceUrl: item.sourceUrl ?? null,
        occurredAt: item.occurredAt ?? null,
        payloadJson: item.payload as Prisma.InputJsonValue,
        evidenceStatus: "active"
      }
    });
    });
  }

  private async writeEvidenceForRepository(
    repositoryLinkId: string,
    projectId: string,
    orgId: string,
    installationId: string,
    repositoryId: string,
    repository: { githubRepositoryId: string; owner: string; name: string; fullName: string; defaultBranch: string | null; htmlUrl: string | null; private: boolean }
  ) {
    await this.writeEvidence(
      { id: repositoryLinkId, projectId, orgId, installationId, repositoryId },
      repository,
      {
        evidenceType: "github_repository",
        providerId: `repository:${repository.githubRepositoryId}`,
        title: repository.fullName,
        summary: "GitHub repository mapped to this Orchestra project. This is engineering evidence, not Product Brain truth.",
        branch: repository.defaultBranch,
        status: "linked",
        sourceUrl: repository.htmlUrl,
        occurredAt: new Date(),
        payload: sanitizePayload({ private: repository.private, defaultBranch: repository.defaultBranch })
      }
    );
  }

  private async runReadOnlyBackfill(
    link: {
      id: string;
      orgId: string;
      projectId: string;
      installationId: string;
      repositoryId: string;
      repository: {
        id: string;
        githubRepositoryId: string;
        owner: string;
        name: string;
        fullName: string;
        defaultBranch: string | null;
        htmlUrl: string | null;
        private: boolean;
      };
      installation: { id: string; githubInstallationId: string };
    },
    input: BackfillInput
  ) {
    const counts = {
      repositories: 0,
      branches: 0,
      pullRequests: 0,
      pullRequestFiles: 0,
      commits: 0,
      commitFiles: 0,
      reviews: 0,
      reviewComments: 0,
      evidenceItems: 0
    };
    const warnings: string[] = [];
    const repositoryPayload = await this.githubRequest<unknown>(
      `/repos/${encodeURIComponent(link.repository.owner)}/${encodeURIComponent(link.repository.name)}`,
      link.installation.githubInstallationId
    );
    const verifiedRepository = normalizeRepository(repositoryPayload);
    await this.prisma.gitHubRepository.update({
      where: { id: link.repositoryId },
      data: {
        owner: verifiedRepository.owner,
        name: verifiedRepository.name,
        fullName: verifiedRepository.fullName,
        defaultBranch: verifiedRepository.defaultBranch,
        private: verifiedRepository.private,
        fork: verifiedRepository.fork,
        htmlUrl: verifiedRepository.htmlUrl,
        lastSyncedAt: new Date()
      }
    });
    await this.writeEvidenceForRepository(
      link.id,
      link.projectId,
      link.orgId,
      link.installationId,
      link.repositoryId,
      { ...link.repository, ...verifiedRepository }
    );
    counts.repositories += 1;
    counts.evidenceItems += 1;

    const branchLimit = input.mode === "incremental" ? Math.min(GITHUB_INCREMENTAL_BRANCH_LIMIT, this.env.GITHUB_SYNC_PAGE_SIZE) : this.env.GITHUB_SYNC_PAGE_SIZE;
    const branches = await this.githubRequest<unknown[]>(
      `/repos/${encodeURIComponent(verifiedRepository.owner)}/${encodeURIComponent(verifiedRepository.name)}/branches?per_page=${branchLimit}`,
      link.installation.githubInstallationId
    ).catch((error) => {
      warnings.push(githubWarning("branches", error));
      return [];
    });
    for (const branch of branches.slice(0, branchLimit)) {
      const record = asRecord(branch);
      const name = typeof record.name === "string" ? record.name : null;
      if (!name) continue;
      await this.writeEvidence(
        link,
        { ...link.repository, ...verifiedRepository },
        {
          evidenceType: "github_branch",
          providerId: `branch:${verifiedRepository.githubRepositoryId}:${name}`,
          title: `Branch ${name}`,
          branch: name,
          sha: typeof asRecord(record.commit).sha === "string" ? String(asRecord(record.commit).sha) : null,
          status: "active",
          sourceUrl: verifiedRepository.htmlUrl ? `${verifiedRepository.htmlUrl}/tree/${encodeURIComponent(name)}` : null,
          occurredAt: new Date(),
          payload: sanitizePayload({ protected: record.protected })
        }
      );
      counts.branches += 1;
      counts.evidenceItems += 1;
    }

    if (input.mode === "incremental" || input.mode === "full") {
      const prBackfillLimit = input.mode === "incremental"
        ? Math.min(GITHUB_INCREMENTAL_PR_LIMIT, this.env.GITHUB_SYNC_MAX_PR_BACKFILL, this.env.GITHUB_SYNC_PAGE_SIZE)
        : Math.min(this.env.GITHUB_SYNC_MAX_PR_BACKFILL, this.env.GITHUB_SYNC_PAGE_SIZE);
      const prDetailLimit = input.mode === "incremental" ? Math.min(GITHUB_INCREMENTAL_PR_DETAIL_LIMIT, prBackfillLimit) : prBackfillLimit;
      const prFileLimit = input.mode === "incremental" ? Math.min(GITHUB_INCREMENTAL_PR_FILE_LIMIT, this.env.GITHUB_SYNC_PAGE_SIZE) : this.env.GITHUB_SYNC_PAGE_SIZE;
      const prs = await this.githubRequest<unknown[]>(
        `/repos/${encodeURIComponent(verifiedRepository.owner)}/${encodeURIComponent(verifiedRepository.name)}/pulls?state=all&per_page=${prBackfillLimit}`,
        link.installation.githubInstallationId
      ).catch((error) => {
        warnings.push(githubWarning("pull_requests", error));
        return [];
      });
      let prDetailCount = 0;
      for (const pr of prs.slice(0, prBackfillLimit)) {
        const prRecord = asRecord(pr);
        const prNumber = typeof prRecord.number === "number" ? prRecord.number : null;
        await this.writeEvidence(
          link,
          { ...link.repository, ...verifiedRepository },
          {
            evidenceType: "github_pull_request",
            providerId: `pr:${verifiedRepository.githubRepositoryId}:${prNumber ?? prRecord.id ?? "unknown"}`,
            title: typeof prRecord.title === "string" ? prRecord.title : null,
            summary: typeof prRecord.body === "string" ? redactAndLimit(prRecord.body) : null,
            branch: typeof asRecord(prRecord.head).ref === "string" ? String(asRecord(prRecord.head).ref) : null,
            sha: typeof asRecord(prRecord.head).sha === "string" ? String(asRecord(prRecord.head).sha) : null,
            pullRequestNumber: prNumber,
            status: typeof prRecord.state === "string" ? prRecord.state : null,
            actorGithubUserId: toProviderId(asRecord(prRecord.user).id),
            actorGithubLogin: typeof asRecord(prRecord.user).login === "string" ? String(asRecord(prRecord.user).login) : null,
            sourceUrl: typeof prRecord.html_url === "string" ? prRecord.html_url : null,
            occurredAt: githubDate(prRecord.updated_at),
            payload: sanitizePayload({ draft: prRecord.draft, mergedAt: prRecord.merged_at })
          }
        );
        counts.pullRequests += 1;
        counts.evidenceItems += 1;

        if (prNumber !== null && prDetailCount < prDetailLimit) {
          prDetailCount += 1;
          const prFiles = await this.githubRequest<unknown[]>(
            `/repos/${encodeURIComponent(verifiedRepository.owner)}/${encodeURIComponent(verifiedRepository.name)}/pulls/${prNumber}/files?per_page=${prFileLimit}`,
            link.installation.githubInstallationId
          ).catch((error) => {
            warnings.push(githubWarning(`pull_request_${prNumber}_files`, error));
            return [];
          });
          for (const file of prFiles.slice(0, prFileLimit)) {
            const fileRecord = asRecord(file);
            const path = typeof fileRecord.filename === "string" ? fileRecord.filename : null;
            if (!path) continue;
            await this.writeEvidence(
              link,
              { ...link.repository, ...verifiedRepository },
              {
                evidenceType: "github_pull_request_file",
                providerId: `pr_file:${verifiedRepository.githubRepositoryId}:${prNumber}:${hashStable(path)}`,
                title: path,
                branch: typeof asRecord(prRecord.head).ref === "string" ? String(asRecord(prRecord.head).ref) : null,
                sha: typeof fileRecord.sha === "string" ? fileRecord.sha : null,
                pullRequestNumber: prNumber,
                path,
                status: typeof fileRecord.status === "string" ? fileRecord.status : "changed",
                actorGithubUserId: toProviderId(asRecord(prRecord.user).id),
                actorGithubLogin: typeof asRecord(prRecord.user).login === "string" ? String(asRecord(prRecord.user).login) : null,
                sourceUrl: typeof fileRecord.blob_url === "string" ? fileRecord.blob_url : typeof prRecord.html_url === "string" ? prRecord.html_url : null,
                occurredAt: githubDate(prRecord.updated_at),
                payload: sanitizePayload({
                  additions: fileRecord.additions,
                  deletions: fileRecord.deletions,
                  changes: fileRecord.changes,
                  previousFilename: fileRecord.previous_filename
                })
              }
            );
            counts.pullRequestFiles += 1;
            counts.evidenceItems += 1;
          }

          if (input.mode === "full") {
            const reviews = await this.githubRequest<unknown[]>(
              `/repos/${encodeURIComponent(verifiedRepository.owner)}/${encodeURIComponent(verifiedRepository.name)}/pulls/${prNumber}/reviews?per_page=${this.env.GITHUB_SYNC_PAGE_SIZE}`,
              link.installation.githubInstallationId
            ).catch((error) => {
              warnings.push(githubWarning(`pull_request_${prNumber}_reviews`, error));
              return [];
            });
            for (const review of reviews.slice(0, this.env.GITHUB_SYNC_PAGE_SIZE)) {
              const reviewRecord = asRecord(review);
              const reviewId = reviewRecord.id;
              await this.writeEvidence(
                link,
                { ...link.repository, ...verifiedRepository },
                {
                  evidenceType: "github_review",
                  providerId: `review:${verifiedRepository.githubRepositoryId}:${reviewId ?? "unknown"}`,
                  title: `PR review ${reviewRecord.state ?? "submitted"}`,
                  summary: typeof reviewRecord.body === "string" ? redactAndLimit(reviewRecord.body) : null,
                  branch: typeof asRecord(prRecord.head).ref === "string" ? String(asRecord(prRecord.head).ref) : null,
                  sha: typeof reviewRecord.commit_id === "string" ? reviewRecord.commit_id : null,
                  pullRequestNumber: prNumber,
                  status: typeof reviewRecord.state === "string" ? reviewRecord.state : null,
                  actorGithubUserId: toProviderId(asRecord(reviewRecord.user).id),
                  actorGithubLogin: typeof asRecord(reviewRecord.user).login === "string" ? String(asRecord(reviewRecord.user).login) : null,
                  sourceUrl: typeof reviewRecord.html_url === "string" ? reviewRecord.html_url : typeof prRecord.html_url === "string" ? prRecord.html_url : null,
                  occurredAt: githubDate(reviewRecord.submitted_at),
                  payload: sanitizePayload({ state: reviewRecord.state })
                }
              );
              counts.reviews += 1;
              counts.evidenceItems += 1;
            }

            const reviewComments = await this.githubRequest<unknown[]>(
              `/repos/${encodeURIComponent(verifiedRepository.owner)}/${encodeURIComponent(verifiedRepository.name)}/pulls/${prNumber}/comments?per_page=${this.env.GITHUB_SYNC_PAGE_SIZE}`,
              link.installation.githubInstallationId
            ).catch((error) => {
              warnings.push(githubWarning(`pull_request_${prNumber}_review_comments`, error));
              return [];
            });
            for (const comment of reviewComments.slice(0, this.env.GITHUB_SYNC_PAGE_SIZE)) {
              const commentRecord = asRecord(comment);
              const commentId = commentRecord.id;
              await this.writeEvidence(
                link,
                { ...link.repository, ...verifiedRepository },
                {
                  evidenceType: "github_review_comment",
                  providerId: `review_comment:${verifiedRepository.githubRepositoryId}:${commentId ?? "unknown"}`,
                  title: typeof commentRecord.path === "string" ? commentRecord.path : null,
                  summary: typeof commentRecord.body === "string" ? redactAndLimit(commentRecord.body) : null,
                  branch: typeof asRecord(prRecord.head).ref === "string" ? String(asRecord(prRecord.head).ref) : null,
                  sha: typeof commentRecord.commit_id === "string" ? commentRecord.commit_id : null,
                  pullRequestNumber: prNumber,
                  path: typeof commentRecord.path === "string" ? commentRecord.path : null,
                  status: "seen",
                  actorGithubUserId: toProviderId(asRecord(commentRecord.user).id),
                  actorGithubLogin: typeof asRecord(commentRecord.user).login === "string" ? String(asRecord(commentRecord.user).login) : null,
                  sourceUrl: typeof commentRecord.html_url === "string" ? commentRecord.html_url : typeof prRecord.html_url === "string" ? prRecord.html_url : null,
                  occurredAt: githubDate(commentRecord.updated_at ?? commentRecord.created_at),
                  payload: sanitizePayload({ position: commentRecord.position, line: commentRecord.line })
                }
              );
              counts.reviewComments += 1;
              counts.evidenceItems += 1;
            }
          }
        }
      }

      const commitBackfillLimit = input.mode === "incremental"
        ? Math.min(GITHUB_INCREMENTAL_COMMIT_LIMIT, this.env.GITHUB_SYNC_MAX_COMMIT_BACKFILL, this.env.GITHUB_SYNC_PAGE_SIZE)
        : Math.min(this.env.GITHUB_SYNC_MAX_COMMIT_BACKFILL, this.env.GITHUB_SYNC_PAGE_SIZE);
      const commitDetailLimit = input.mode === "incremental" ? GITHUB_INCREMENTAL_COMMIT_DETAIL_LIMIT : this.env.GITHUB_SYNC_MAX_COMMIT_BACKFILL;
      const commits = await this.githubRequest<unknown[]>(
        `/repos/${encodeURIComponent(verifiedRepository.owner)}/${encodeURIComponent(verifiedRepository.name)}/commits?per_page=${commitBackfillLimit}`,
        link.installation.githubInstallationId
      ).catch((error) => {
        warnings.push(githubWarning("commits", error));
        return [];
      });
      let commitDetailCount = 0;
      for (const commit of commits.slice(0, commitBackfillLimit)) {
        const record = asRecord(commit);
        const sha = typeof record.sha === "string" ? record.sha : null;
        if (!sha) continue;
        const commitInfo = asRecord(record.commit);
        await this.writeEvidence(
          link,
          { ...link.repository, ...verifiedRepository },
          {
            evidenceType: "github_commit",
            providerId: `commit:${verifiedRepository.githubRepositoryId}:${sha}`,
            title: typeof commitInfo.message === "string" ? redactAndLimit(commitInfo.message, 240) : null,
            sha,
            status: "seen",
            actorGithubUserId: toProviderId(asRecord(record.author).id),
            actorGithubLogin: typeof asRecord(record.author).login === "string" ? String(asRecord(record.author).login) : null,
            sourceUrl: typeof record.html_url === "string" ? record.html_url : null,
            occurredAt: githubDate(asRecord(commitInfo.author).date),
            payload: sanitizePayload({ parents: Array.isArray(record.parents) ? record.parents.length : 0 })
          }
        );
        counts.commits += 1;
        counts.evidenceItems += 1;

        const commitDetail = commitDetailCount < commitDetailLimit
          ? await this.githubRequest<unknown>(
              `/repos/${encodeURIComponent(verifiedRepository.owner)}/${encodeURIComponent(verifiedRepository.name)}/commits/${encodeURIComponent(sha)}`,
              link.installation.githubInstallationId
            ).catch((error) => {
              warnings.push(githubWarning(`commit_${sha}_files`, error));
              return null;
            })
          : null;
        if (commitDetail) commitDetailCount += 1;
        const files = Array.isArray(asRecord(commitDetail).files) ? (asRecord(commitDetail).files as unknown[]) : [];
        for (const file of files.slice(0, this.env.GITHUB_SYNC_PAGE_SIZE)) {
          const fileRecord = asRecord(file);
          const path = typeof fileRecord.filename === "string" ? fileRecord.filename : null;
          if (!path) continue;
          await this.writeEvidence(
            link,
            { ...link.repository, ...verifiedRepository },
            {
              evidenceType: "github_commit_file",
              providerId: `commit_file:${verifiedRepository.githubRepositoryId}:${sha}:${hashStable(path)}`,
              title: path,
              sha,
              path,
              status: typeof fileRecord.status === "string" ? fileRecord.status : "changed",
              actorGithubUserId: toProviderId(asRecord(record.author).id),
              actorGithubLogin: typeof asRecord(record.author).login === "string" ? String(asRecord(record.author).login) : null,
              sourceUrl: typeof fileRecord.blob_url === "string" ? fileRecord.blob_url : typeof record.html_url === "string" ? record.html_url : null,
              occurredAt: githubDate(asRecord(commitInfo.author).date),
              payload: sanitizePayload({
                additions: fileRecord.additions,
                deletions: fileRecord.deletions,
                changes: fileRecord.changes,
                previousFilename: fileRecord.previous_filename
              })
            }
          );
          counts.commitFiles += 1;
          counts.evidenceItems += 1;
        }
      }
    } else {
      warnings.push("Repository metadata mode skipped PR and commit backfill by request.");
    }

    return { counts, warnings };
  }

  private async resolveInstallationPayload(githubInstallationId: string) {
    if (this.allowMockGitHubApi()) {
      return {
        installation: {
          id: githubInstallationId,
          repository_selection: "selected",
          permissions: {},
          events: SUPPORTED_WEBHOOK_EVENTS,
          created_at: new Date().toISOString()
        }
      };
    }
    this.assertGitHubAppConfigured();
    const installation = await this.githubAppRequest<unknown>(`/app/installations/${encodeURIComponent(githubInstallationId)}`);
    return { installation };
  }

  private async refreshInstallationRepositories(installation: { id: string; orgId: string; githubInstallationId: string }) {
    if (this.allowMockGitHubApi()) return;
    const response = await this.githubRequest<unknown>(
      `/installation/repositories?per_page=${this.env.GITHUB_SYNC_MAX_REPOS_PER_INSTALLATION}`,
      installation.githubInstallationId
    );
    const repositories = Array.isArray(asRecord(response).repositories) ? (asRecord(response).repositories as unknown[]) : [];
    for (const repositoryPayload of repositories.slice(0, this.env.GITHUB_SYNC_MAX_REPOS_PER_INSTALLATION)) {
      const repository = normalizeRepository(repositoryPayload);
      if (repository.githubRepositoryId === "unknown") continue;
      await this.upsertRepository(installation, repository);
    }
  }

  private async resolveRepositoryForInstallation(
    installation: { id: string; orgId: string; githubInstallationId: string },
    input: LinkRepositoryInput
  ) {
    if (this.allowMockGitHubApi()) {
      return {
        githubRepositoryId: input.githubRepositoryId,
        owner: input.owner,
        name: input.name,
        fullName: input.fullName ?? `${input.owner}/${input.name}`,
        defaultBranch: input.defaultBranch ?? null,
        private: input.private,
        fork: input.fork,
        htmlUrl: input.htmlUrl ?? null
      };
    }
    const repository = normalizeRepository(
      await this.githubRequest<unknown>(
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`,
        installation.githubInstallationId
      )
    );
    if (repository.githubRepositoryId !== input.githubRepositoryId) {
      throw new AppError(403, "GitHub repository does not belong to the selected installation", "github_repository_not_in_installation");
    }
    await this.upsertRepository(installation, repository);
    return repository;
  }

  private async upsertRepository(
    installation: { id: string; orgId: string },
    repository: ReturnType<typeof normalizeRepository>
  ) {
    return this.prisma.gitHubRepository.upsert({
      where: {
        installationId_githubRepositoryId: {
          installationId: installation.id,
          githubRepositoryId: repository.githubRepositoryId
        }
      },
      create: {
        orgId: installation.orgId,
        installationId: installation.id,
        githubRepositoryId: repository.githubRepositoryId,
        owner: repository.owner,
        name: repository.name,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        private: repository.private,
        fork: repository.fork,
        htmlUrl: repository.htmlUrl,
        status: "active"
      },
      update: {
        owner: repository.owner,
        name: repository.name,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        private: repository.private,
        fork: repository.fork,
        htmlUrl: repository.htmlUrl,
        status: "active",
        archivedAt: null
      }
    });
  }

  private async findMappedUser(orgId: string, githubUserId?: string | null, githubLogin?: string | null) {
    if (!githubUserId && !githubLogin) return null;
    return this.prisma.gitHubUserLink.findFirst({
      where: {
        orgId,
        status: "active",
        OR: [
          ...(githubUserId ? [{ githubUserId }] : []),
          ...(githubLogin ? [{ githubLogin: { equals: githubLogin, mode: "insensitive" as const } }] : [])
        ]
      },
      select: { userId: true }
    });
  }

  private async exchangeUserCodeForIdentity(code: string) {
    if (!this.env.GITHUB_APP_CLIENT_ID || !this.env.GITHUB_APP_CLIENT_SECRET) {
      throw new AppError(503, "GitHub user linking OAuth is not configured", "github_user_oauth_not_configured");
    }
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.env.GITHUB_APP_CLIENT_ID,
        client_secret: this.env.GITHUB_APP_CLIENT_SECRET,
        code,
        redirect_uri: this.env.GITHUB_APP_CALLBACK_URL
      })
    });
    const tokenJson = asRecord(await tokenResponse.json());
    const accessToken = typeof tokenJson.access_token === "string" ? tokenJson.access_token : null;
    if (!accessToken) {
      throw new AppError(502, "GitHub user linking token exchange failed", "github_user_oauth_exchange_failed");
    }
    const userResponse = await fetch("https://api.github.com/user", {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}` }
    });
    const user = asRecord(await userResponse.json());
    const githubUserId = typeof user.id === "number" || typeof user.id === "string" ? String(user.id) : null;
    const githubLogin = typeof user.login === "string" ? user.login : null;
    if (!githubUserId || !githubLogin) {
      throw new AppError(502, "GitHub user identity was incomplete", "github_user_identity_incomplete");
    }
    return {
      githubUserId,
      githubLogin,
      githubAvatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
      githubEmailHash: typeof user.email === "string" ? hashEmail(user.email) : null
    };
  }

  private toSafeWebhookPayload(payload: unknown) {
    const body = asRecord(payload);
    return sanitizePayload({
      action: body.action,
      installation: body.installation,
      repository: body.repository,
      sender: body.sender,
      pull_request: summarizeRecord(body.pull_request, ["id", "number", "title", "state", "html_url", "created_at", "updated_at"]),
      review: summarizeRecord(body.review, ["id", "state", "html_url", "submitted_at"]),
      comment: summarizeRecord(body.comment, ["id", "html_url", "created_at", "updated_at", "path"]),
      check_run: summarizeRecord(body.check_run, ["id", "name", "status", "conclusion", "html_url", "head_sha"]),
      deployment: summarizeRecord(body.deployment, ["id", "environment", "ref", "sha", "created_at"]),
      deployment_status: summarizeRecord(body.deployment_status, ["id", "state", "target_url", "created_at"])
    });
  }

  private assertIntegrationEnabled() {
    if (!this.env.GITHUB_INTEGRATION_ENABLED) {
      throw new AppError(403, "GitHub integration is disabled", "github_integration_disabled");
    }
  }

  private async ensureGitHubInstallationAdmin(actor: Actor) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId: actor.orgId,
        userId: actor.userId,
        isActive: true,
        globalRole: { in: ["owner", "admin"] },
        user: { isActive: true }
      },
      select: { id: true }
    });
    if (!membership) {
      throw new AppError(403, "Organization owner or admin access is required", "github_installation_admin_required");
    }
  }

  private assertOwnerAllowed(owner: string) {
    const allowlist = this.env.GITHUB_ALLOWED_REPO_OWNER_ALLOWLIST.split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (allowlist.length > 0 && !allowlist.includes(owner.toLowerCase())) {
      throw new AppError(403, "GitHub repository owner is not allowlisted", "github_repo_owner_not_allowlisted");
    }
  }

  private getMissingConfiguration() {
    const missing = [] as string[];
    if (!this.env.GITHUB_APP_ID) missing.push("GITHUB_APP_ID");
    if (!this.env.GITHUB_APP_PRIVATE_KEY) missing.push("GITHUB_APP_PRIVATE_KEY");
    if (!this.env.GITHUB_APP_SETUP_URL) missing.push("GITHUB_APP_SETUP_URL");
    if (this.env.GITHUB_WEBHOOKS_ENABLED && !this.env.GITHUB_APP_WEBHOOK_SECRET) missing.push("GITHUB_APP_WEBHOOK_SECRET");
    return missing;
  }

  private async buildInstallUrl(actor: Actor) {
    if (!this.env.GITHUB_APP_SETUP_URL) return null;
    const url = new URL(this.env.GITHUB_APP_SETUP_URL);
    url.searchParams.set("state", await this.buildInstallState(actor));
    return url.toString();
  }

  private buildInstallState(actor: Actor) {
    return this.buildActorState(actor, "installation");
  }

  private buildUserLinkState(actor: Actor) {
    return this.buildActorState(actor, "user_link");
  }

  private async buildActorState(actor: Actor, purpose: GitHubOAuthPurpose) {
    const expiresAt = Date.now() + GITHUB_OAUTH_STATE_TTL_MS;
    const nonce = randomBytes(16).toString("hex");
    const row = await this.prisma.gitHubOAuthState.create({
      data: {
        orgId: actor.orgId,
        actorUserId: actor.userId,
        purpose,
        nonceHash: createHash("sha256").update(nonce).digest("hex"),
        expiresAt: new Date(expiresAt)
      },
      select: { id: true }
    });
    const raw = `${row.id}:${actor.orgId}:${actor.userId}:${purpose}:${expiresAt}:${nonce}`;
    const sig = createHmac("sha256", this.env.CONNECTOR_OAUTH_STATE_SECRET).update(raw).digest("hex");
    return Buffer.from(JSON.stringify({ stateId: row.id, orgId: actor.orgId, userId: actor.userId, purpose, expiresAt, nonce, sig })).toString(
      "base64url"
    );
  }

  private consumeInstallState(rawState?: string): Promise<Actor> {
    return this.consumeActorState(rawState, "installation", {
      missing: "github_install_state_missing",
      invalid: "github_install_state_invalid",
      expired: "github_install_state_expired",
      signature: "github_install_state_invalid_signature",
      used: "github_install_state_used",
      label: "GitHub installation state"
    });
  }

  private consumeUserLinkState(rawState: string | undefined, actor: Actor): Promise<Actor> {
    return this.consumeActorState(rawState, "user_link", {
      missing: "github_user_link_state_missing",
      invalid: "github_user_link_state_invalid",
      expired: "github_user_link_state_expired",
      signature: "github_user_link_state_invalid_signature",
      used: "github_user_link_state_used",
      label: "GitHub user link state"
    }, actor);
  }

  private async consumeActorState(
    rawState: string | undefined,
    purpose: GitHubOAuthPurpose,
    codes: { missing: string; invalid: string; expired: string; signature: string; used: string; label: string },
    expectedActor?: Actor
  ): Promise<Actor> {
    if (!rawState) {
      throw new AppError(400, `Missing ${codes.label}`, codes.missing);
    }
    let parsed: { stateId?: unknown; orgId?: unknown; userId?: unknown; purpose?: unknown; expiresAt?: unknown; nonce?: unknown; sig?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(rawState, "base64url").toString("utf-8")) as typeof parsed;
    } catch {
      throw new AppError(400, `Invalid ${codes.label}`, codes.invalid);
    }
    if (
      typeof parsed.stateId !== "string" ||
      typeof parsed.orgId !== "string" ||
      typeof parsed.userId !== "string" ||
      parsed.purpose !== purpose ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.sig !== "string"
    ) {
      throw new AppError(400, `Invalid ${codes.label}`, codes.invalid);
    }
    if (parsed.expiresAt < Date.now()) {
      throw new AppError(400, `${codes.label} expired`, codes.expired);
    }
    const raw = `${parsed.stateId}:${parsed.orgId}:${parsed.userId}:${parsed.purpose}:${parsed.expiresAt}:${parsed.nonce}`;
    const expected = createHmac("sha256", this.env.CONNECTOR_OAUTH_STATE_SECRET).update(raw).digest("hex");
    if (!constantTimeEqual(expected, parsed.sig)) {
      throw new AppError(400, `${codes.label} signature invalid`, codes.signature);
    }
    if (expectedActor && (parsed.orgId !== expectedActor.orgId || parsed.userId !== expectedActor.userId)) {
      throw new AppError(400, `Invalid ${codes.label}`, codes.invalid);
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId: parsed.orgId,
        userId: parsed.userId,
        isActive: true,
        user: { isActive: true }
      },
      select: { id: true, globalRole: true }
    });
    if (!membership) {
      throw new AppError(403, `${codes.label} actor is no longer authorized`, codes.invalid);
    }
    if (purpose === "installation" && membership.globalRole !== "owner" && membership.globalRole !== "admin") {
      throw new AppError(403, "Organization owner or admin access is required", "github_installation_admin_required");
    }

    const consumed = await this.prisma.gitHubOAuthState.updateMany({
      where: {
        id: parsed.stateId,
        orgId: parsed.orgId,
        actorUserId: parsed.userId,
        purpose,
        nonceHash: createHash("sha256").update(parsed.nonce).digest("hex"),
        usedAt: null,
        expiresAt: { gt: new Date() }
      },
      data: { usedAt: new Date() }
    });
    if (consumed.count !== 1) {
      throw new AppError(400, `${codes.label} is expired or already used`, codes.used);
    }
    return { orgId: parsed.orgId, userId: parsed.userId };
  }

  private allowMockGitHubApi() {
    return this.env.NODE_ENV === "test";
  }

  private assertGitHubAppConfigured() {
    const missing = this.getMissingConfiguration();
    if (missing.length > 0) {
      throw new AppError(503, "GitHub App credentials are not configured", "github_app_credentials_missing");
    }
  }

  private async githubAppRequest<T>(path: string): Promise<T> {
    const response = await fetchGitHubWithRetry(`${GITHUB_API_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.createGitHubAppJwt()}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION
      }
    });
    return this.parseGitHubResponse<T>(response, "github_app_api_failed");
  }

  private async githubRequest<T>(path: string, githubInstallationId: string): Promise<T> {
    const token = await this.createInstallationAccessToken(githubInstallationId);
    const response = await fetchGitHubWithRetry(`${GITHUB_API_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION
      }
    });
    return this.parseGitHubResponse<T>(response, "github_installation_api_failed");
  }

  private async createInstallationAccessToken(githubInstallationId: string) {
    this.assertGitHubAppConfigured();
    const cached = this.installationTokenCache.get(githubInstallationId);
    if (cached && cached.expiresAtMs - Date.now() > 60_000) {
      return cached.token;
    }
    const response = await fetchGitHubWithRetry(
      `${GITHUB_API_BASE_URL}/app/installations/${encodeURIComponent(githubInstallationId)}/access_tokens`,
      {
        method: "POST",
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.createGitHubAppJwt()}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        }
      }
    );
    const data = await this.parseGitHubResponse<Record<string, unknown>>(response, "github_installation_token_failed");
    const token = typeof data.token === "string" ? data.token : null;
    if (!token) {
      throw new AppError(502, "GitHub installation access token response was incomplete", "github_installation_token_missing");
    }
    const expiresAt = typeof data.expires_at === "string" ? Date.parse(data.expires_at) : Number.NaN;
    this.installationTokenCache.set(githubInstallationId, {
      token,
      expiresAtMs: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 50 * 60 * 1000
    });
    return token;
  }

  private createGitHubAppJwt() {
    this.assertGitHubAppConfigured();
    if (this.allowMockGitHubApi()) {
      return "test-github-app-jwt";
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
    const payload = base64UrlJson({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: this.env.GITHUB_APP_ID
    });
    const input = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(input);
    signer.end();
    const privateKey = this.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
    return `${input}.${signer.sign(privateKey).toString("base64url")}`;
  }

  private async parseGitHubResponse<T>(response: Response, code: string): Promise<T> {
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new AppError(429, "GitHub API rate limit or permission error", "github_rate_limited");
      }
      throw new AppError(502, "GitHub API request failed", code);
    }
    return (await response.json()) as T;
  }

  private async getInstallationById(orgId: string, installationId: string) {
    const installation = await this.prisma.gitHubInstallation.findFirst({
      where: { id: installationId, orgId, archivedAt: null }
    });
    if (!installation) throw new AppError(404, "GitHub installation not found", "github_installation_not_found");
    return installation;
  }

  private async getInstallationByGitHubId(orgId: string, githubInstallationId: string) {
    const installation = await this.prisma.gitHubInstallation.findFirst({
      where: { githubInstallationId, orgId, archivedAt: null }
    });
    if (!installation) throw new AppError(404, "GitHub installation not found", "github_installation_not_found");
    return installation;
  }

  private toInstallationDto(row: {
    id: string;
    orgId: string;
    githubInstallationId: string;
    githubAccountLogin: string | null;
    githubAccountType: string | null;
    repositorySelection: string | null;
    status: string;
    installedAt: Date | null;
    suspendedAt: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      orgId: row.orgId,
      githubInstallationId: row.githubInstallationId,
      githubAccountLogin: row.githubAccountLogin,
      githubAccountType: row.githubAccountType,
      repositorySelection: row.repositorySelection,
      status: row.status,
      installedAt: row.installedAt?.toISOString() ?? null,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      readOnlyMode: true,
      writeActionsEnabled: false
    };
  }

  private toRepositoryDto(row: {
    id: string;
    installationId: string;
    githubRepositoryId: string;
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string | null;
    private: boolean;
    fork: boolean;
    htmlUrl: string | null;
    status: string;
    lastSyncedAt: Date | null;
  }) {
    return {
      id: row.id,
      installationId: row.installationId,
      githubRepositoryId: row.githubRepositoryId,
      owner: row.owner,
      name: row.name,
      fullName: row.fullName,
      defaultBranch: row.defaultBranch,
      private: row.private,
      fork: row.fork,
      htmlUrl: row.htmlUrl,
      status: row.status,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null
    };
  }

  private toRepositoryLinkDto(row: {
    id: string;
    projectId: string;
    installationId: string;
    repositoryId: string;
    linkedByUserId: string | null;
    status: string;
    lastSyncedAt: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    repository?: {
      id: string;
      installationId: string;
      githubRepositoryId: string;
      owner: string;
      name: string;
      fullName: string;
      defaultBranch: string | null;
      private: boolean;
      fork: boolean;
      htmlUrl: string | null;
      status: string;
      lastSyncedAt: Date | null;
    };
    installation?: { githubInstallationId: string; githubAccountLogin: string | null };
  }) {
    return {
      id: row.id,
      projectId: row.projectId,
      installationId: row.installationId,
      githubInstallationId: row.installation?.githubInstallationId ?? null,
      repositoryId: row.repositoryId,
      linkedByUserId: row.linkedByUserId,
      status: row.status,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      repository: row.repository ? this.toRepositoryDto(row.repository) : null,
      readOnlyMode: true,
      writeActionsEnabled: false
    };
  }

  private toSyncRunDto(row: {
    id: string;
    projectId: string | null;
    repositoryLinkId: string | null;
    mode: string;
    status: string;
    startedByUserId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    countsJson: unknown;
    warningsJson: unknown;
    errorsJson: unknown;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      projectId: row.projectId,
      repositoryLinkId: row.repositoryLinkId,
      mode: row.mode,
      status: row.status,
      startedByUserId: row.startedByUserId,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      counts: row.countsJson,
      warnings: row.warningsJson,
      errors: row.errorsJson,
      createdAt: row.createdAt.toISOString(),
      readOnlyMode: true,
      writeActionsEnabled: false
    };
  }

  private async loadCodeStatusEvidence(projectId: string, actor: Actor) {
    const links = await this.prisma.gitHubRepositoryProjectLink.findMany({
      where: { orgId: actor.orgId, projectId, archivedAt: null },
      include: { repository: true, installation: true },
      orderBy: { updatedAt: "desc" },
      take: 10
    });
    const syncRuns = await this.prisma.gitHubSyncRun.findMany({
      where: { orgId: actor.orgId, projectId },
      orderBy: { createdAt: "desc" },
      take: 20
    });

    try {
      const rows = await this.prisma.gitHubEngineeringEvidence.findMany({
        where: {
          orgId: actor.orgId,
          projectId,
          evidenceStatus: "active",
          evidenceType: {
            in: ["github_pull_request", "github_pull_request_file", "github_check_run", "github_commit", "github_branch"]
          }
        },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: 700
      });
      return { links, syncRuns, ...this.partitionCodeStatusEvidence(rows), degradedReason: null };
    } catch (error) {
      if (!isDatabaseConnectionPressure(error)) throw error;
      return {
        links,
        syncRuns,
        prs: [],
        files: [],
        checks: [],
        commits: [],
        branches: [],
        degradedReason: "GitHub evidence refresh is temporarily degraded because the database connection pool is saturated."
      };
    }
  }

  private partitionCodeStatusEvidence(rows: any[]) {
    return {
      prs: rows.filter((row) => row.evidenceType === "github_pull_request").slice(0, 100),
      files: rows.filter((row) => row.evidenceType === "github_pull_request_file").slice(0, 300),
      checks: rows.filter((row) => row.evidenceType === "github_check_run").slice(0, 100),
      commits: rows.filter((row) => row.evidenceType === "github_commit").slice(0, 100),
      branches: rows.filter((row) => row.evidenceType === "github_branch").slice(0, 100)
    };
  }

  private toCodeStatusBundle(projectId: string, actor: Actor, evidence: Awaited<ReturnType<GitHubIntegrationService["loadCodeStatusEvidence"]>>) {
    const links = evidence.links;
    const syncRuns = evidence.syncRuns;
    const link = links[0] ?? null;
    const overlapRisks = this.detectConflictRisks(evidence.prs, evidence.files);
    const failingChecks = evidence.checks.filter((check) => this.isFailingCheck(check));
    const pullRequests = evidence.prs.map((pr) => this.toCodePullRequestDto(pr, evidence.files, overlapRisks));
    const conflicts = this.toCodeConflictDtos(overlapRisks, failingChecks);
    const branches = evidence.branches.map((branch) => this.toCodeBranchDto(branch));
    const activity = this.toCodeActivityDtos([...evidence.prs, ...evidence.checks, ...evidence.commits, ...evidence.branches], syncRuns);
    const activePrs = pullRequests.filter((pr) => pr.status !== "closed" && pr.status !== "merged");
    const latestMainCommit = evidence.commits.find((commit) => commit.branch === (link?.repository?.defaultBranch ?? "main")) ?? evidence.commits[0] ?? null;
    const limitations = [
      ...(evidence.degradedReason ? [evidence.degradedReason] : []),
      "GitHub remains read-only in beta. Evidence does not mutate Product Brain or LiveDoc truth."
    ];
    if (!link) limitations.unshift("No GitHub repository is linked to this project.");

    const readiness = this.getReadiness();
    const state = !readiness.enabled || !readiness.configured
      ? "not_configured"
      : evidence.degradedReason
        ? "degraded"
        : !link
          ? "not_connected"
          : pullRequests.length === 0 && branches.length === 0 && activity.length === 0
            ? "empty"
            : "ready";
    const setupUrl = this.env.GITHUB_APP_SETUP_URL || this.buildInstallUrl(actor);

    return {
      projectId,
      status: {
        state,
        repositoryLabel: link?.repository?.fullName ?? null,
        repositoryOwner: link?.repository?.owner ?? null,
        repositoryName: link?.repository?.name ?? null,
        defaultBranch: link?.repository?.defaultBranch ?? null,
        lastSyncedAt: link?.lastSyncedAt?.toISOString() ?? syncRuns.find((run) => run.status === "completed")?.finishedAt?.toISOString() ?? null,
        openPrCount: activePrs.filter((pr) => pr.status === "open" || pr.status === "ready" || pr.status === "draft" || pr.status === "stale").length,
        readyToMergeCount: activePrs.filter((pr) => pr.status === "ready").length,
        failingChecksCount: failingChecks.length,
        latestMainCommitSha: latestMainCommit?.sha ?? null,
        latestMainCommitAt: latestMainCommit ? this.evidenceTime(latestMainCommit).toISOString() : null,
        testCoverage: null,
        conflictRiskCount: conflicts.length,
        setupUrl,
        installUrl: setupUrl,
        sourceStates: {
          github: {
            state,
            detail: evidence.degradedReason ?? (link ? "Real GitHub engineering evidence loaded from the linked repository." : "No GitHub repository is linked to this project.")
          }
        },
        limitations,
        readOnlyMode: true,
        writeActionsEnabled: false
      },
      pullRequests,
      conflicts,
      branches,
      activity,
      latestSyncRun: syncRuns[0] ? this.toSyncRunDto(syncRuns[0]) : null,
      latestSyncRuns: syncRuns.map((run) => this.toSyncRunDto(run)),
      linkedRepositories: links.map((row) => this.toRepositoryLinkDto(row)),
      readOnlyMode: true,
      writeActionsEnabled: false
    };
  }

  private toCodeConflictDtos(overlapRisks: ReturnType<GitHubIntegrationService["detectConflictRisks"]>, failingChecks: any[]) {
    const checkRisks = failingChecks.slice(0, 20).map((check) => ({
      id: `github-check-${check.id}`,
      severity: "medium",
      title: check.title ?? check.path ?? check.branch ?? "Failing GitHub check",
      description: "A real GitHub check-run evidence item indicates a failing or blocked status.",
      prs: check.pullRequestNumber ? [check.pullRequestNumber] : [],
      overlappingFiles: [],
      riskReason: "failing_checks",
      confidence: 0.82,
      openTargets: [this.safeOpenTarget(check.openTargetJson) ?? { targetType: "github_check_run", targetRef: { evidenceId: check.id } }],
      sourceRefs: [{ type: "github_check_run", id: check.id, label: check.title ?? "GitHub check run" }]
    }));
    return [...overlapRisks, ...checkRisks];
  }

  private toCodeActivityDtos(rows: any[], syncRuns: any[]) {
    const evidenceActivity = rows
      .slice()
      .sort((a, b) => this.evidenceTime(b).getTime() - this.evidenceTime(a).getTime())
      .slice(0, 80)
      .map((row) => ({
        id: row.id,
        type: row.evidenceType,
        title: row.title ?? row.summary ?? row.path ?? row.sha ?? "GitHub activity",
        summary: summarizeRecord(row.payloadJson, ["action", "state", "status", "conclusion", "mergedAt", "additions", "deletions"]),
        actor: row.actorGithubLogin ?? null,
        branch: row.branch ?? null,
        sha: row.sha ?? null,
        pullRequestNumber: row.pullRequestNumber ?? null,
        status: row.status ?? null,
        occurredAt: this.evidenceTime(row).toISOString(),
        openTarget: this.safeOpenTarget(row.openTargetJson) ?? { targetType: row.evidenceType, targetRef: { evidenceId: row.id } },
        sourceRefs: [{ type: row.evidenceType, id: row.id }]
      }));
    const syncActivity = syncRuns.slice(0, 5).map((run) => ({
      id: run.id,
      type: "github_sync_run",
      title: `GitHub sync ${run.status}`,
      summary: { mode: run.mode, counts: run.countsJson, warnings: run.warningsJson },
      actor: null,
      branch: null,
      sha: null,
      pullRequestNumber: null,
      status: String(run.status),
      occurredAt: (run.finishedAt ?? run.startedAt ?? run.createdAt).toISOString(),
      openTarget: { targetType: "github_sync_run", targetRef: { syncRunId: run.id } },
      sourceRefs: [{ type: "github_sync_run", id: run.id }]
    }));
    return [...evidenceActivity, ...syncActivity]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, 80);
  }

  private toCodeBranchDto(branch: any) {
    const payload = asRecord(branch.payloadJson);
    const latestCommitAt = this.evidenceTime(branch);
    return {
      id: branch.id,
      name: branch.branch ?? branch.title ?? "unknown",
      latestCommitSha: branch.sha ?? toProviderId(payload.sha),
      latestCommitAt: latestCommitAt.toISOString(),
      ahead: typeof payload.ahead === "number" ? payload.ahead : null,
      behind: typeof payload.behind === "number" ? payload.behind : null,
      stale: Date.now() - latestCommitAt.getTime() > 30 * 24 * 60 * 60 * 1000,
      protectionSummary: typeof payload.protectionSummary === "string" ? payload.protectionSummary : null,
      checksSummary: typeof payload.checksSummary === "string" ? payload.checksSummary : null,
      openTarget: this.safeOpenTarget(branch.openTargetJson) ?? { targetType: "github_branch", targetRef: { evidenceId: branch.id, branch: branch.branch } },
      sourceRefs: [{ type: "github_branch", id: branch.id }]
    };
  }

  private evidenceTime(row: any) {
    const value = row.occurredAt ?? row.updatedAt ?? row.createdAt ?? new Date();
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private codeStatusBundleCacheKey(projectId: string, actor: Actor) {
    return `${actor.orgId}:${actor.userId}:${projectId}`;
  }

  private invalidateCodeStatusBundleCache(projectId: string) {
    for (const key of codeStatusBundleCache.keys()) {
      if (key.endsWith(`:${projectId}`)) codeStatusBundleCache.delete(key);
    }
  }

  private pruneCodeStatusBundleCache() {
    const now = Date.now();
    for (const [key, record] of codeStatusBundleCache.entries()) {
      if (now - record.storedAt > CODE_STATUS_BUNDLE_CACHE_TTL_MS) codeStatusBundleCache.delete(key);
    }
  }

  private toCodePullRequestDto(pr: any, files: any[], risks: Array<{ prNumbers: number[]; riskReason: string }>) {
    const payload = asRecord(pr.payloadJson);
    const prFiles = files.filter((file) => file.pullRequestNumber === pr.pullRequestNumber);
    const additions = prFiles.reduce((sum, file) => sum + numberField(asRecord(file.payloadJson).additions), 0);
    const deletions = prFiles.reduce((sum, file) => sum + numberField(asRecord(file.payloadJson).deletions), 0);
    const hasConflict = risks.some((risk) => pr.pullRequestNumber && risk.prNumbers.includes(pr.pullRequestNumber));
    const updatedAt = pr.occurredAt ?? pr.updatedAt ?? pr.createdAt;
    const status = payload.mergedAt
      ? "merged"
      : String(pr.status) === "closed"
        ? "closed"
        : payload.draft === true
          ? "draft"
          : Date.now() - new Date(updatedAt).getTime() > 7 * 24 * 60 * 60 * 1000
            ? "stale"
            : "ready";
    return {
      id: pr.id,
      number: pr.pullRequestNumber,
      title: pr.title ?? `PR #${pr.pullRequestNumber ?? "unknown"}`,
      author: pr.actorGithubLogin ?? null,
      status,
      branch: pr.branch ?? null,
      baseBranch: null,
      additions,
      deletions,
      changedFiles: prFiles.map((file) => file.path).filter(Boolean),
      age: Math.max(0, Math.floor((Date.now() - new Date(pr.createdAt).getTime()) / (24 * 60 * 60 * 1000))),
      updatedAt: new Date(updatedAt).toISOString(),
      checksSummary: null,
      reviewSummary: null,
      hasConflict,
      conflictReason: hasConflict ? "overlapping_files" : null,
      openTarget: this.safeOpenTarget(pr.openTargetJson) ?? { targetType: "github_pull_request", targetRef: { evidenceId: pr.id, pullRequestNumber: pr.pullRequestNumber } },
      sourceRefs: [{ type: "github_pull_request", id: pr.id }]
    };
  }

  private detectConflictRisks(prs: any[], files: any[]) {
    const openPrNumbers = new Set(prs.filter((pr) => String(pr.status) === "open").map((pr) => pr.pullRequestNumber).filter(Boolean));
    const byPath = new Map<string, any[]>();
    for (const file of files) {
      if (!file.path || !file.pullRequestNumber || !openPrNumbers.has(file.pullRequestNumber)) continue;
      const existing = byPath.get(file.path) ?? [];
      existing.push(file);
      byPath.set(file.path, existing);
    }
    return Array.from(byPath.entries())
      .filter(([, rows]) => new Set(rows.map((row) => row.pullRequestNumber)).size > 1)
      .map(([path, rows]) => {
        const prNumbers = Array.from(new Set(rows.map((row) => row.pullRequestNumber))).filter((value): value is number => typeof value === "number");
        return {
          id: `github-overlap-${hashStable(`${path}:${prNumbers.join(",")}`)}`,
          severity: "high",
          title: `Conflict risk on ${path}`,
          description: "Multiple open PRs modify the same file. This is an overlapping-file conflict risk, not a confirmed merge conflict.",
          prNumbers,
          overlappingFiles: [path],
          riskReason: "overlapping_files",
          confidence: 0.82,
          openTargets: rows.slice(0, 4).map((row) => this.safeOpenTarget(row.openTargetJson) ?? { targetType: "github_pull_request_file", targetRef: { evidenceId: row.id, path } }),
          sourceRefs: rows.slice(0, 4).map((row) => ({ type: "github_pull_request_file", id: row.id, label: `PR #${row.pullRequestNumber} ${path}` }))
        };
      });
  }

  private isFailingCheck(check: any) {
    const payload = asRecord(check.payloadJson);
    const text = `${check.status ?? ""} ${payload.conclusion ?? ""} ${payload.status ?? ""}`;
    return /\b(failure|failed|timed_out|cancelled|action_required)\b/i.test(text);
  }

  private prIsDraft(pr: any) {
    return asRecord(pr.payloadJson).draft === true;
  }

  private safeOpenTarget(value: unknown) {
    const record = asRecord(value);
    if (typeof record.targetType !== "string") return null;
    const targetRef = asRecord(record.targetRef);
    if (Object.keys(targetRef).length === 0) return null;
    return { targetType: record.targetType, targetRef };
  }

  private toUserLinkDto(row: {
    id: string;
    userId: string;
    githubUserId: string;
    githubLogin: string;
    githubAvatarUrl: string | null;
    status: string;
    linkedAt: Date;
    revokedAt: Date | null;
    lastSeenAt: Date | null;
  }) {
    return {
      linked: row.status === "active",
      id: row.id,
      userId: row.userId,
      githubUserId: row.githubUserId,
      githubLogin: row.githubLogin,
      githubAvatarUrl: row.githubAvatarUrl,
      status: row.status,
      linkedAt: row.linkedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      tokenStored: false
    };
  }

  private assertReleaseValidated() {
    if (!isProviderReleaseValidated(this.env, "github")) {
      throw new AppError(
        409,
        "GitHub actions are unavailable until live provider validation passes",
        PROVIDER_RELEASE_VALIDATION_REASON,
        { provider: "github" }
      );
    }
  }
}

function getHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function summarizeRecord(value: unknown, keys: string[]) {
  const record = asRecord(value);
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

function constantTimeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function hashEmail(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function hashStable(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function toProviderId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isDatabaseConnectionPressure(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /EMAXCONNSESSION|max clients|too many clients|connection pool|pool_size|remaining connection slots/i.test(message);
}

function redactAndLimit(value: string, maxLength = 4000) {
  const sanitized = sanitizePayload({ value }).value;
  const text = typeof sanitized === "string" ? sanitized : "[redacted]";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...[truncated]` : text;
}

function githubDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
