import { describe, expect, it, vi } from "vitest";
import {
  enqueueGeneralDashboardRefresh,
  enqueueProjectDashboardRefreshByProjectId
} from "../src/lib/dashboard/refresh.js";

describe("dashboard refresh enqueue", () => {
  it("does not fail the caller when project dashboard refresh enqueue fails", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => {
          throw new Error("pool exhausted");
        })
      }
    };
    const jobs = {
      enqueue: vi.fn(async () => undefined)
    };

    await expect(
      enqueueProjectDashboardRefreshByProjectId(prisma as any, jobs as any, "project-1", "communication_proposal_created")
    ).resolves.toBeUndefined();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("does not fail the caller when general dashboard refresh job execution fails", async () => {
    const prisma = {
      jobRun: {
        upsert: vi.fn(async () => undefined)
      }
    };
    const jobs = {
      enqueue: vi.fn(async () => {
        throw new Error("inline refresh failed");
      })
    };

    await expect(enqueueGeneralDashboardRefresh(prisma as any, jobs as any, "org-1", "manual_refresh")).resolves.toBeUndefined();
    expect(jobs.enqueue).toHaveBeenCalled();
  });

  it("does not let a slow dashboard refresh enqueue hold a user request open", async () => {
    const previousTimeout = process.env.DASHBOARD_REFRESH_ENQUEUE_TIMEOUT_MS;
    process.env.DASHBOARD_REFRESH_ENQUEUE_TIMEOUT_MS = "5";
    try {
      const prisma = {
        project: {
          findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" }))
        },
        jobRun: {
          upsert: vi.fn(() => new Promise(() => undefined))
        }
      };
      const jobs = {
        enqueue: vi.fn(async () => undefined)
      };

      const startedAt = Date.now();
      await enqueueProjectDashboardRefreshByProjectId(
        prisma as any,
        jobs as any,
        "project-1",
        "communication_proposal_created"
      );

      expect(Date.now() - startedAt).toBeLessThan(100);
      expect(prisma.jobRun.upsert).toHaveBeenCalled();
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DASHBOARD_REFRESH_ENQUEUE_TIMEOUT_MS;
      } else {
        process.env.DASHBOARD_REFRESH_ENQUEUE_TIMEOUT_MS = previousTimeout;
      }
    }
  });
});
