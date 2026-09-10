import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { fetchGitHubWithRetry, GitHubIntegrationService } from "../src/modules/github/service.js";
import { createGitHubWebhookSignature, verifyGitHubWebhookSignature } from "../src/modules/github/signature.js";
import { normalizeWebhookEvidence, sanitizePayload } from "../src/modules/github/normalizers.js";

const env = {
  NODE_ENV: "test",
  GITHUB_INTEGRATION_ENABLED: true,
  GITHUB_WEBHOOKS_ENABLED: true,
  GITHUB_BACKFILL_ENABLED: false,
  GITHUB_USER_LINKING_ENABLED: false,
  GITHUB_CONTENT_SCAN_ENABLED: false,
  GITHUB_READ_ONLY_MODE: true,
  GITHUB_WRITE_ACTIONS_ENABLED: false,
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY: "fake-private-key",
  GITHUB_APP_SETUP_URL: "https://github.com/apps/orchestra/installations/new",
  GITHUB_APP_CALLBACK_URL: "https://api.example.com/v1/github/callback",
  GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
  GITHUB_SYNC_PAGE_SIZE: 50,
  GITHUB_SYNC_MAX_REPOS_PER_INSTALLATION: 100,
  GITHUB_SYNC_MAX_PR_BACKFILL: 100,
  GITHUB_SYNC_MAX_COMMIT_BACKFILL: 500,
  GITHUB_WEBHOOK_MAX_PAYLOAD_BYTES: 1024 * 1024,
  GITHUB_ALLOWED_REPO_OWNER_ALLOWLIST: "",
  CONNECTOR_OAUTH_STATE_SECRET: "test-connector-oauth-state-secret"
} as const;

function oauthStatePrisma(extra: Record<string, unknown> = {}) {
  let consumed = false;
  return {
    ...extra,
    organizationMembership: {
      findFirst: vi.fn(async () => ({ id: "membership-1", globalRole: "owner" }))
    },
    gitHubOAuthState: {
      create: vi.fn(async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })),
      updateMany: vi.fn(async () => {
        if (consumed) return { count: 0 };
        consumed = true;
        return { count: 1 };
      })
    }
  };
}

describe("GitHub integration foundation", () => {
  it.each(["failed", "duplicate", "received"])("reclaims a %s delivery instead of permanently discarding it", async (status) => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { gitHubWebhookEvent: {
      findFirst: vi.fn().mockResolvedValue({ id: "retry-event", status, updatedAt: new Date(0) }), updateMany
    } };
    const service = new GitHubIntegrationService(prisma as never, env as never, {} as never, {} as never);
    const rawBody = "{}";
    const result = await service.handleWebhook({ rawBody, body: {}, headers: {
      "x-github-delivery": "retry-delivery", "x-github-event": "push",
      "x-hub-signature-256": createGitHubWebhookSignature(rawBody, env.GITHUB_APP_WEBHOOK_SECRET)
    } });
    expect(result.status).toBe("ignored"); // No linked repository, not falsely processed.
    const claim = updateMany.mock.calls[0]![0];
    expect(claim.where.updatedAt).toEqual(new Date(0));
    expect(claim.data.errorMessage).toMatch(/^processing:/);
    expect(updateMany.mock.calls[1]![0].where.errorMessage).toBe(claim.data.errorMessage);
  });

  it("does not process a delivery owned by a concurrent worker", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = new GitHubIntegrationService({ gitHubWebhookEvent: {
      findFirst: vi.fn().mockResolvedValue({ id: "owned", status: "queued", updatedAt: new Date() }), updateMany
    } } as never, env as never, {} as never, {} as never);
    const rawBody = "{}";
    await expect(service.handleWebhook({ rawBody, body: {}, headers: {
      "x-github-delivery": "owned", "x-github-event": "push",
      "x-hub-signature-256": createGitHubWebhookSignature(rawBody, env.GITHUB_APP_WEBHOOK_SECRET)
    } })).rejects.toMatchObject({ code: "github_delivery_processing" });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("refuses late evidence writes after a link is revoked", async () => {
    const upsert = vi.fn();
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]), gitHubEngineeringEvidence: { upsert } };
    const service = new GitHubIntegrationService({ $transaction: (fn: any) => fn(tx) } as never, env as never, {} as never, {} as never);
    await (service as any).writeEvidence({ id: "revoked-link", orgId: "org" }, {}, {});
    expect(upsert).not.toHaveBeenCalled();
  });

  it("never overwrites newer evidence with an older or undated provider event", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: "link" }]), gitHubEngineeringEvidence: { upsert, updateMany } };
    const service = new GitHubIntegrationService({ $transaction: (fn: any) => fn(tx) } as never, env as never, {} as never, {} as never);
    const occurredAt = new Date("2026-01-01T00:00:00Z");
    const item = { providerId: "check", evidenceType: "github_check_run", status: "queued", occurredAt, payload: {} };
    await (service as any).writeEvidence({ id: "link", orgId: "org" }, {}, item);
    expect(upsert.mock.calls[0]![0].update).toEqual({});
    expect(updateMany.mock.calls[0]![0].where.OR).toEqual([{ occurredAt: null }, { occurredAt: { lt: occurredAt } }]);
    updateMany.mockClear();
    await (service as any).writeEvidence({ id: "link", orgId: "org" }, {}, { ...item, occurredAt: null });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("distinguishes merged PRs from closed-unmerged PRs", () => {
    const payload = { action: "closed", repository: repositoryPayload(), pull_request: { number: 1, state: "closed", merged: false } };
    expect(normalizeWebhookEvidence("pull_request", payload)[0]?.status).toBe("closed");
    expect(normalizeWebhookEvidence("pull_request", { ...payload, pull_request: { ...payload.pull_request, merged: true } })[0]?.status).toBe("merged");
  });
  it("blocks direct production provider actions until GitHub passes live validation", async () => {
    const service = new GitHubIntegrationService(
      {} as never,
      {
        ...env,
        NODE_ENV: "production",
        ORCHESTRA_PROFILE: "mvp_beta",
        MVP_BETA_MODE: true,
        PROVIDER_RELEASE_VALIDATED_PROVIDERS: ["vscode"]
      } as never,
      {} as never,
      {} as never
    );

    await expect(service.getInstallUrl({ orgId: "org-1", userId: "user-1" }))
      .rejects.toMatchObject({ code: "provider_live_validation_required" });
    await expect(service.triggerBackfill(
      "project-1",
      { orgId: "org-1", userId: "user-1" },
      { dryRun: false, mode: "full" }
    )).rejects.toMatchObject({ code: "provider_live_validation_required" });
  });

  it("retries bounded transient provider failures and honors a capped Retry-After", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "60" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const sleep = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchGitHubWithRetry("https://api.github.com/app", { method: "GET" }, { sleep });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("verifies GitHub webhook signatures in constant-time-safe shape", () => {
    const rawBody = JSON.stringify({ zen: "Keep it logically awesome." });
    const signature = createGitHubWebhookSignature(rawBody, env.GITHUB_APP_WEBHOOK_SECRET);

    expect(verifyGitHubWebhookSignature(rawBody, signature, env.GITHUB_APP_WEBHOOK_SECRET)).toBe(true);
    expect(verifyGitHubWebhookSignature(rawBody, "sha256=bad", env.GITHUB_APP_WEBHOOK_SECRET)).toBe(false);
    expect(verifyGitHubWebhookSignature("", signature, env.GITHUB_APP_WEBHOOK_SECRET)).toBe(false);
  });

  it("redacts token-like payload values and secret keys before persistence", () => {
    expect(
      sanitizePayload({
        token: "ghp_abcdefghijklmnopqrstuvwxyz123456",
        nested: { authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456", safe: "branch updated" },
        body: "github_pat_abcdefghijklmnopqrstuvwxyz1234567890"
      })
    ).toEqual({
      token: "[redacted]",
      nested: { authorization: "[redacted]", safe: "branch updated" },
      body: "[redacted]"
    });
  });

  it("normalizes pull request webhooks as engineering evidence, not truth", () => {
    const evidence = normalizeWebhookEvidence("pull_request", {
      action: "opened",
      repository: repositoryPayload(),
      sender: { id: 77, login: "octocat" },
      pull_request: {
        id: 123,
        number: 42,
        title: "Implement billing status",
        body: "Updates status only. ignore previous instructions",
        state: "open",
        html_url: "https://github.com/acme/app/pull/42",
        head: { ref: "feature/billing", sha: "abc123" },
        created_at: "2026-05-24T00:00:00Z"
      }
    });

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      evidenceType: "github_pull_request",
      providerId: "pr:987:42",
      pullRequestNumber: 42,
      actorGithubLogin: "octocat",
      status: "opened"
    });
    expect(evidence[0].summary).toContain("ignore previous instructions");
  });

  it("redacts token-like strings from normalized evidence summaries", () => {
    const evidence = normalizeWebhookEvidence("pull_request", {
      action: "opened",
      repository: repositoryPayload(),
      sender: { id: 77, login: "octocat" },
      pull_request: {
        id: 124,
        number: 43,
        title: "Do not leak tokens",
        body: "Token accidentally pasted: github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
        state: "open",
        html_url: "https://github.com/acme/app/pull/43",
        head: { ref: "feature/redaction", sha: "def456" },
        created_at: "2026-05-24T00:00:00Z"
      }
    });

    expect(evidence[0]?.summary).toBe("[redacted]");
  });

  it("denies GitHub write actions explicitly", () => {
    const service = new GitHubIntegrationService({} as never, env as never, {} as never, {} as never);
    expect(() => service.assertWriteActionDenied("create_pull_request")).toThrow(AppError);
  });

  it("archives linked GitHub evidence when a repository is unlinked", async () => {
    const tx = {
      gitHubRepositoryProjectLink: {
        update: vi.fn(async () => ({
          id: "repo-link-1",
          orgId: "org-1",
          projectId: "project-1",
          installationId: "installation-1",
          repositoryId: "repository-1",
          linkedByUserId: "user-1",
          status: "archived",
          archivedAt: new Date("2026-06-02T00:00:00.000Z"),
          lastSyncedAt: null,
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-02T00:00:00.000Z"),
          repository: {
            id: "repository-1",
            installationId: "installation-1",
            githubRepositoryId: "987",
            fullName: "orchestra/app",
            owner: "orchestra",
            name: "app",
            defaultBranch: "main",
            private: true,
            fork: false,
            htmlUrl: "https://github.com/orchestra/app",
            status: "active",
            lastSyncedAt: null
          },
          installation: { githubInstallationId: "123", githubAccountLogin: "orchestra" }
        }))
      },
      gitHubEngineeringEvidence: {
        updateMany: vi.fn(async () => ({ count: 3 }))
      }
    };
    const prisma = {
      gitHubRepositoryProjectLink: {
        findFirst: vi.fn(async () => ({
          id: "repo-link-1",
          orgId: "org-1",
          projectId: "project-1",
          repository: { fullName: "orchestra/app" }
        }))
      },
      $transaction: vi.fn(async (callback: any) => callback(tx))
    };
    const service = new GitHubIntegrationService(
      prisma as never,
      env as never,
      { ensureProjectManager: vi.fn(async () => undefined) } as never,
      { record: vi.fn(async () => undefined) } as never
    );

    await expect(service.archiveRepositoryLink("project-1", "repo-link-1", { orgId: "org-1", userId: "user-1" })).resolves.toMatchObject({
      id: "repo-link-1",
      status: "archived"
    });
    expect(tx.gitHubEngineeringEvidence.updateMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", projectId: "project-1", repositoryLinkId: "repo-link-1", evidenceStatus: "active" },
      data: { evidenceStatus: "archived" }
    });
  });

  it("returns degraded aggregate code status when Supabase connection pressure blocks evidence refresh", async () => {
    const service = new GitHubIntegrationService(
      {
        gitHubRepositoryProjectLink: {
          findMany: vi.fn(async () => [
            {
              id: "repo-link-1",
              orgId: "org-1",
              projectId: "project-1",
              installationId: "installation-1",
              repositoryId: "repository-1",
              linkedByUserId: "user-1",
              status: "active",
              lastSyncedAt: new Date("2026-06-01T00:00:00.000Z"),
              archivedAt: null,
              createdAt: new Date("2026-06-01T00:00:00.000Z"),
              updatedAt: new Date("2026-06-01T00:00:00.000Z"),
              installation: { githubInstallationId: "123", githubAccountLogin: "orchestra" },
              repository: {
                id: "repository-1",
                installationId: "installation-1",
                githubRepositoryId: "987",
                owner: "orchestra",
                name: "app",
                fullName: "orchestra/app",
                defaultBranch: "main",
                private: true,
                fork: false,
                htmlUrl: "https://github.com/orchestra/app",
                status: "active",
                lastSyncedAt: new Date("2026-06-01T00:00:00.000Z")
              }
            }
          ])
        },
        gitHubSyncRun: {
          findMany: vi.fn(async () => [
            {
              id: "sync-1",
              projectId: "project-1",
              repositoryLinkId: "repo-link-1",
              mode: "incremental",
              status: "completed",
              startedByUserId: "user-1",
              startedAt: new Date("2026-06-01T00:00:00.000Z"),
              finishedAt: new Date("2026-06-01T00:01:00.000Z"),
              countsJson: {},
              warningsJson: [],
              errorsJson: [],
              createdAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ])
        },
        gitHubEngineeringEvidence: {
          findMany: vi.fn(async () => {
            throw new Error("FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15");
          })
        }
      } as never,
      env as never,
      { ensureProjectAccess: vi.fn(async () => undefined) } as never,
      { record: vi.fn().mockResolvedValue({}) } as never
    );

    await expect(service.getCodeStatusBundle("project-1", { orgId: "org-1", userId: "user-1" })).resolves.toMatchObject({
      status: {
        state: "degraded",
        repositoryLabel: "orchestra/app",
        limitations: expect.arrayContaining([expect.stringContaining("database connection pool")])
      },
      pullRequests: [],
      linkedRepositories: [expect.objectContaining({ id: "repo-link-1" })],
      latestSyncRun: expect.objectContaining({ id: "sync-1", status: "completed" })
    });
  });

  it("generates a signed GitHub App install URL and accepts the callback without bearer auth", async () => {
    const create = vi.fn(async ({ data }: any) => ({
      id: "installation-1",
      orgId: data.orgId,
      githubInstallationId: data.githubInstallationId,
      githubAccountLogin: data.githubAccountLogin,
      githubAccountType: data.githubAccountType,
      repositorySelection: data.repositorySelection,
      status: data.status,
      installedAt: data.installedAt,
      suspendedAt: null,
      archivedAt: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T00:00:00.000Z")
    }));
    const service = new GitHubIntegrationService(
      oauthStatePrisma({ gitHubInstallation: { findUnique: vi.fn().mockResolvedValue(null), create } }) as never,
      env as never,
      {} as never,
      { record: vi.fn().mockResolvedValue({}) } as never
    );

    const install = await service.getInstallUrl({ orgId: "org-1", userId: "user-1" });
    const state = new URL(install.installUrl!).searchParams.get("state");

    expect(state).toBeTruthy();
    await expect(
      service.handleInstallationCallbackFromState({ installationId: "10", setupAction: "install", state: state! })
    ).resolves.toMatchObject({ githubInstallationId: "10", status: "active" });
    await expect(
      service.handleInstallationCallbackFromState({ installationId: "10", setupAction: "install", state: state! })
    ).rejects.toMatchObject({ code: "github_install_state_used" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orgId: "org-1", githubInstallationId: "10" })
    }));
  });

  it("rejects a GitHub installation that another organization already claimed", async () => {
    const service = new GitHubIntegrationService(
      oauthStatePrisma({
        gitHubInstallation: {
          findUnique: vi.fn().mockResolvedValue({ id: "installation-victim", orgId: "org-victim", githubInstallationId: "10" }),
          create: vi.fn(),
          update: vi.fn()
        }
      }) as never,
      env as never,
      {} as never,
      { record: vi.fn().mockResolvedValue({}) } as never
    );
    const install = await service.getInstallUrl({ orgId: "org-1", userId: "user-1" });
    const state = new URL(install.installUrl!).searchParams.get("state");

    await expect(service.handleInstallationCallbackFromState({ installationId: "10", state: state! }))
      .rejects.toMatchObject({ code: "github_installation_already_claimed" });
  });

  it("rejects oversized webhooks before parsing provider data", async () => {
    const service = new GitHubIntegrationService({} as never, { ...env, GITHUB_WEBHOOK_MAX_PAYLOAD_BYTES: 10 } as never, {} as never, {} as never);

    await expect(
      service.handleWebhook({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "push",
          "x-hub-signature-256": "sha256=bad"
        },
        rawBody: JSON.stringify({ large: "payload" }),
        body: {}
      })
    ).rejects.toMatchObject({ code: "github_webhook_payload_too_large" });
  });

  it("dedupes repeated webhook deliveries by delivery id and event", async () => {
    const rawBody = JSON.stringify({ installation: { id: 10 }, repository: repositoryPayload() });
    const signature = createGitHubWebhookSignature(rawBody, env.GITHUB_APP_WEBHOOK_SECRET);
    const update = vi.fn().mockResolvedValue({});
    const service = new GitHubIntegrationService(
      {
        gitHubInstallation: { findFirst: vi.fn().mockResolvedValue(null) },
        gitHubWebhookEvent: {
          findFirst: vi.fn().mockResolvedValue({ id: "event-1", status: "processed" }),
          update
        }
      } as never,
      env as never,
      oauthStatePrisma() as never,
      {} as never
    );

    await expect(
      service.handleWebhook({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signature
        },
        rawBody,
        body: JSON.parse(rawBody)
      })
    ).resolves.toMatchObject({ status: "duplicate" });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects invalid-signature webhook deliveries without writing database rows", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "event-invalid-1" });
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({});
    const service = new GitHubIntegrationService(
      {
        gitHubWebhookEvent: {
          findFirst,
          update,
          create
        }
      } as never,
      env as never,
      {} as never,
      {} as never
    );

    await expect(
      service.handleWebhook({
        headers: {
          "x-github-delivery": "delivery-invalid-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": "sha256=bad"
        },
        rawBody: JSON.stringify({ repository: repositoryPayload() }),
        body: { repository: repositoryPayload() }
      })
    ).rejects.toMatchObject({ code: "github_webhook_invalid_signature" });

    expect(findFirst).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects direct GitHub identity callbacks outside test mode", async () => {
    const service = new GitHubIntegrationService(
      oauthStatePrisma() as never,
      { ...env, NODE_ENV: "production", GITHUB_USER_LINKING_ENABLED: true, GITHUB_APP_CLIENT_ID: "client-id" } as never,
      {} as never,
      { record: vi.fn().mockResolvedValue({}) } as never
    );
    const start = await service.getUserLinkStart({ orgId: "org-1", userId: "user-1" });

    await expect(
      service.handleUserLinkCallback(
        { orgId: "org-1", userId: "user-1" },
        { state: start.state, githubUserId: "123", githubLogin: "octocat" }
      )
    ).rejects.toMatchObject({ code: "github_user_identity_missing" });
  });

  it("requires signed GitHub user-link state before linking identities", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "link-1",
      orgId: "org-1",
      userId: "user-1",
      githubUserId: "123",
      githubLogin: "octocat",
      githubAvatarUrl: null,
      githubEmailHash: null,
      status: "active",
      linkedAt: new Date("2026-06-01T00:00:00.000Z"),
      lastSeenAt: new Date("2026-06-01T00:00:00.000Z")
    });
    const service = new GitHubIntegrationService(
      oauthStatePrisma({ gitHubUserLink: { upsert } }) as never,
      { ...env, GITHUB_USER_LINKING_ENABLED: true, GITHUB_APP_CLIENT_ID: "client-id" } as never,
      {} as never,
      { record: vi.fn().mockResolvedValue({}) } as never
    );
    const start = await service.getUserLinkStart({ orgId: "org-1", userId: "user-1" });
    expect(start.state).toBeTruthy();
    expect(start.authorizationUrl).toContain(`state=${encodeURIComponent(start.state)}`);

    await expect(
      service.handleUserLinkCallback(
        { orgId: "org-1", userId: "user-1" },
        { githubUserId: "123", githubLogin: "octocat" }
      )
    ).rejects.toMatchObject({ code: "github_user_link_state_missing" });

    await expect(
      service.handleUserLinkCallback(
        { orgId: "org-1", userId: "other-user" },
        { state: start.state, githubUserId: "123", githubLogin: "octocat" }
      )
    ).rejects.toMatchObject({ code: "github_user_link_state_invalid" });

    await expect(
      service.handleUserLinkCallback(
        { orgId: "org-1", userId: "user-1" },
        { state: start.state, githubUserId: "123", githubLogin: "octocat" }
      )
    ).resolves.toMatchObject({ linked: true, githubLogin: "octocat" });
    await expect(
      service.handleUserLinkCallback(
        { orgId: "org-1", userId: "user-1" },
        { state: start.state, githubUserId: "123", githubLogin: "octocat" }
      )
    ).rejects.toMatchObject({ code: "github_user_link_state_used" });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("fails closed for live installation callbacks when GitHub App credentials cannot verify installation metadata", async () => {
    const service = new GitHubIntegrationService(
      {
        gitHubInstallation: { upsert: vi.fn() }
      } as never,
      { ...env, NODE_ENV: "production", GITHUB_APP_PRIVATE_KEY: "invalid-private-key" } as never,
      {} as never,
      { record: vi.fn().mockResolvedValue({}) } as never
    );

    await expect(
      service.handleInstallationCallback({ orgId: "org-1", userId: "user-1" }, { installationId: "10" })
    ).rejects.toThrow();
  });

  it("fails closed for live repository linking when installation repository access cannot be verified", async () => {
    const repositoryUpsert = vi.fn();
    const service = new GitHubIntegrationService(
      {
        project: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" }) },
        gitHubInstallation: {
          findFirst: vi.fn().mockResolvedValue({
            id: "installation-1",
            orgId: "org-1",
            githubInstallationId: "10"
          })
        },
        gitHubRepository: { upsert: repositoryUpsert }
      } as never,
      { ...env, NODE_ENV: "production", GITHUB_APP_PRIVATE_KEY: "invalid-private-key" } as never,
      { ensureProjectManager: vi.fn().mockResolvedValue({}) } as never,
      {} as never
    );

    await expect(
      service.linkRepository("project-1", { orgId: "org-1", userId: "user-1" }, {
        installationId: "installation-1",
        githubRepositoryId: "987",
        owner: "acme",
        name: "app",
        private: true,
        fork: false
      })
    ).rejects.toThrow();
    expect(repositoryUpsert).not.toHaveBeenCalled();
  });

  it("backfills branches, PRs, reviews, and changed files through read-only GitHub API calls", async () => {
    const fetchMock = vi.fn(async (input: { toString(): string }, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith("/app/installations/10/access_tokens")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ token: "installation-token" });
      }
      if (url.endsWith("/repos/acme/app")) return jsonResponse(repositoryPayload());
      if (url.includes("/branches?")) return jsonResponse([{ name: "main", commit: { sha: "branch-sha" }, protected: true }]);
      if (url.includes("/pulls?")) {
        return jsonResponse([
          {
            id: 4242,
            number: 42,
            title: "Feature PR",
            body: "Implements the safe path",
            state: "open",
            html_url: "https://github.com/acme/app/pull/42",
            updated_at: "2026-05-24T00:00:00Z",
            head: { ref: "feature/safe", sha: "pr-sha" },
            user: { id: 77, login: "octocat" }
          }
        ]);
      }
      if (url.includes("/pulls/42/files?")) {
        return jsonResponse([
          {
            filename: "src/index.ts",
            sha: "file-sha",
            status: "modified",
            additions: 3,
            deletions: 1,
            changes: 4,
            blob_url: "https://github.com/acme/app/blob/pr/src/index.ts"
          }
        ]);
      }
      if (url.includes("/pulls/42/reviews?")) {
        return jsonResponse([
          {
            id: 9001,
            state: "APPROVED",
            body: "Looks bounded",
            html_url: "https://github.com/acme/app/pull/42#pullrequestreview-9001",
            commit_id: "pr-sha",
            submitted_at: "2026-05-24T01:00:00Z",
            user: { id: 88, login: "reviewer" }
          }
        ]);
      }
      if (url.includes("/pulls/42/comments?")) {
        return jsonResponse([
          {
            id: 9002,
            path: "src/index.ts",
            body: "Keep this scoped",
            html_url: "https://github.com/acme/app/pull/42#discussion_r9002",
            commit_id: "pr-sha",
            updated_at: "2026-05-24T01:10:00Z",
            user: { id: 89, login: "commenter" }
          }
        ]);
      }
      if (url.includes("/commits?")) {
        return jsonResponse([
          {
            sha: "commit-sha",
            html_url: "https://github.com/acme/app/commit/commit-sha",
            author: { id: 77, login: "octocat" },
            commit: { message: "Bounded change", author: { date: "2026-05-24T02:00:00Z" } }
          }
        ]);
      }
      if (url.endsWith("/commits/commit-sha")) {
        return jsonResponse({
          files: [
            {
              filename: "src/worker.ts",
              status: "added",
              additions: 9,
              deletions: 0,
              changes: 9,
              blob_url: "https://github.com/acme/app/blob/main/src/worker.ts"
            }
          ]
        });
      }
      throw new Error(`Unexpected GitHub API call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const evidenceUpsert = vi.fn().mockResolvedValue({});
    const syncRun = {
      id: "sync-1",
      projectId: "project-1",
      repositoryLinkId: "repo-link-1",
      mode: "full",
      status: "running",
      startedByUserId: "user-1",
      startedAt: new Date("2026-05-24T00:00:00Z"),
      finishedAt: null,
      countsJson: {},
      warningsJson: [],
      errorsJson: [],
      createdAt: new Date("2026-05-24T00:00:00Z")
    };
    const service = new GitHubIntegrationService(
      {
        gitHubRepositoryProjectLink: {
          findFirst: vi.fn().mockResolvedValue({
            id: "repo-link-1",
            orgId: "org-1",
            projectId: "project-1",
            installationId: "installation-1",
            repositoryId: "repository-1",
            repository: { id: "repository-1", ...repositoryPayloadAsRow() },
            installation: { id: "installation-1", githubInstallationId: "10" }
          })
        },
        gitHubSyncRun: {
          create: vi.fn().mockResolvedValue(syncRun),
          update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...syncRun, ...data }))
        },
        gitHubRepository: { update: vi.fn().mockResolvedValue({}) },
        $transaction: async (callback: (tx: any) => unknown) => callback({
          $queryRaw: vi.fn().mockResolvedValue([{ id: "repo-link-1" }]),
          gitHubEngineeringEvidence: { upsert: evidenceUpsert, updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
        }),
        gitHubEngineeringEvidence: { upsert: evidenceUpsert, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        gitHubUserLink: { findFirst: vi.fn().mockResolvedValue(null) }
      } as never,
      { ...env, GITHUB_BACKFILL_ENABLED: true } as never,
      { ensureProjectManager: vi.fn().mockResolvedValue({}) } as never,
      { record: vi.fn().mockResolvedValue({}) } as never
    );

    const result = await service.triggerBackfill("project-1", { orgId: "org-1", userId: "user-1" }, { dryRun: false, mode: "full" });

    expect(result.counts).toMatchObject({
      repositories: 1,
      branches: 1,
      pullRequests: 1,
      pullRequestFiles: 1,
      commits: 1,
      commitFiles: 1,
      reviews: 1,
      reviewComments: 1
    });
    const evidenceTypes = evidenceUpsert.mock.calls.map((call) => call[0].create.evidenceType);
    expect(evidenceTypes).toEqual(
      expect.arrayContaining([
        "github_repository",
        "github_branch",
        "github_pull_request",
        "github_pull_request_file",
        "github_review",
        "github_review_comment",
        "github_commit",
        "github_commit_file"
      ])
    );
    const unsafeRepoWrites = fetchMock.mock.calls.filter(([, init]) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      return method !== "GET" && !String(fetchMock.mock.calls[0][0]).endsWith("/access_tokens");
    });
    expect(unsafeRepoWrites).toHaveLength(0);
  });
});

function repositoryPayload() {
  return {
    id: 987,
    name: "app",
    full_name: "acme/app",
    default_branch: "main",
    private: true,
    fork: false,
    html_url: "https://github.com/acme/app",
    owner: { id: 10, login: "acme", type: "Organization" }
  };
}

function repositoryPayloadAsRow() {
  return {
    githubRepositoryId: "987",
    owner: "acme",
    name: "app",
    fullName: "acme/app",
    defaultBranch: "main",
    private: true,
    fork: false,
    htmlUrl: "https://github.com/acme/app"
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
