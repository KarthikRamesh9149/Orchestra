import type { PrismaClient } from "@prisma/client";
import type { JobDispatcher, JobName } from "./types.js";

function sanitizeBackgroundDispatchError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 500);
  }
  if (typeof error === "string" && error.trim()) {
    return error.slice(0, 500);
  }
  return "Background job dispatch failed";
}

async function markPendingJobDispatchFailed(
  prisma: Pick<PrismaClient, "jobRun">,
  idempotencyKey: string,
  error: unknown
) {
  try {
    await prisma.jobRun.updateMany({
      where: {
        idempotencyKey,
        status: "pending"
      },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: sanitizeBackgroundDispatchError(error)
      }
    });
  } catch {
    // Best-effort dispatch telemetry must never crash the request path.
  }
}

export function enqueueJobInBackground<TPayload>(
  prisma: Pick<PrismaClient, "jobRun">,
  jobs: JobDispatcher,
  name: JobName,
  payload: TPayload,
  idempotencyKey: string,
  onFailure?: () => Promise<unknown>
) {
  const failed = async (error: unknown) => {
    await markPendingJobDispatchFailed(prisma, idempotencyKey, error);
    await onFailure?.().catch(() => undefined);
  };
  try {
    void Promise.resolve(jobs.enqueue(name, payload, idempotencyKey)).catch(failed);
  } catch (error) {
    void failed(error);
  }
}
