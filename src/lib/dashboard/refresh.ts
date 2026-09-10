import type { PrismaClient } from "@prisma/client";
import { invalidateProjectAggregateCaches } from "./aggregate-cache.js";
import { jobKeys } from "../jobs/keys.js";
import { JobNames, type JobDispatcher } from "../jobs/types.js";

type DashboardRefreshScope = "general" | "project";
type DashboardRefreshOptions = {
  skip?: boolean;
};

function enqueueTimeoutMs() {
  const parsed = Number(process.env.DASHBOARD_REFRESH_ENQUEUE_TIMEOUT_MS ?? 750);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 750;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function triggerBucket() {
  return new Date().toISOString().slice(0, 16);
}

async function enqueueDashboardRefresh(
  prisma: PrismaClient,
  jobs: JobDispatcher,
  input: {
    scope: DashboardRefreshScope;
    orgId: string;
    projectId?: string | null;
    reason: string;
  }
) {
  const operation = (async () => {
    const key = jobKeys.refreshDashboardSnapshot(
      input.scope,
      input.projectId ?? input.orgId,
      `${input.reason}:${triggerBucket()}`
    );
    const payload = {
      scope: input.scope,
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      reason: input.reason,
      idempotencyKey: key
    };

    await prisma.jobRun.upsert({
      where: { idempotencyKey: key },
      update: {
        jobType: JobNames.refreshDashboardSnapshot,
        status: "pending",
        payloadJson: payload,
        finishedAt: null,
        lastError: null
      },
      create: {
        jobType: JobNames.refreshDashboardSnapshot,
        status: "pending",
        idempotencyKey: key,
        payloadJson: payload
      }
    });

    await jobs.enqueue(JobNames.refreshDashboardSnapshot, payload, key);
  })().catch(() => undefined);

  const timeoutMs = enqueueTimeoutMs();
  if (timeoutMs === 0) {
    await operation;
    return;
  }

  await Promise.race([operation, wait(timeoutMs)]);
}

export async function enqueueGeneralDashboardRefresh(
  prisma: PrismaClient,
  jobs: JobDispatcher,
  orgId: string,
  reason: string,
  options: DashboardRefreshOptions = {}
) {
  if (options.skip) {
    return;
  }

  await enqueueDashboardRefresh(prisma, jobs, {
    scope: "general",
    orgId,
    reason
  });
}

export async function enqueueProjectDashboardRefreshByProjectId(
  prisma: PrismaClient,
  jobs: JobDispatcher,
  projectId: string,
  reason: string,
  options: DashboardRefreshOptions = {}
) {
  invalidateProjectAggregateCaches(projectId);

  if (options.skip) {
    return;
  }

  if (!("project" in prisma) || typeof prisma.project?.findUnique !== "function") {
    return;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true }
  });

  if (!project) {
    return;
  }

  await Promise.all([
    enqueueDashboardRefresh(prisma, jobs, {
      scope: "project",
      orgId: project.orgId,
      projectId: project.id,
      reason
    }),
    enqueueDashboardRefresh(prisma, jobs, {
      scope: "general",
      orgId: project.orgId,
      reason
    })
  ]);
}
