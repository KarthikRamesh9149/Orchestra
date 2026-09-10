import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import type { AppContext } from "../../types/index.js";
import type { JobDispatcher, JobName } from "./types.js";
import type { AppEnv } from "../../config/env.js";
import { assertProductionQueueMode, getJobExecutionPolicy } from "./policy.js";
import { normalizeCorrelationId, resolveRequestId } from "../observability/correlation.js";

export type JobHandler = (payload: unknown) => Promise<void>;

export type WorkerJobDescriptor = {
  id?: string;
  name: string;
  data: unknown;
  attemptsMade?: number;
  opts?: { attempts?: number };
};

export function buildWorkerObservation(job: WorkerJobDescriptor) {
  const jobId = normalizeCorrelationId(job.id) ?? "unassigned";
  const payloadRequestId =
    job.data && typeof job.data === "object" ? normalizeCorrelationId((job.data as { requestId?: unknown }).requestId) : null;
  const attempt = (job.attemptsMade ?? 0) + 1;
  return {
    requestId: payloadRequestId ?? resolveRequestId(job.id),
    jobId,
    attempt,
    attemptClass: attempt > 1 ? "retry" : "initial",
    maxAttempts: job.opts?.attempts ?? 1
  } as const;
}

export function normalizeBullMqJobId(idempotencyKey: string): string {
  // BullMQ reserves ":" inside custom job ids. Keep deterministic idempotency while using a safe alphabet.
  return idempotencyKey.replace(/:/g, "|");
}

export class InlineJobDispatcher implements JobDispatcher {
  constructor(
    public handlers: Partial<Record<JobName, JobHandler>>,
    private readonly env?: AppEnv
  ) {
    if (env) {
      assertProductionQueueMode(env);
    }
  }

  async enqueue<TPayload>(name: JobName, payload: TPayload) {
    if (this.env) {
      assertProductionQueueMode(this.env);
    }
    const handler = this.handlers[name];
    if (!handler) {
      throw new Error(`No inline handler registered for job ${name}`);
    }

    await handler(payload);
  }
}

export class BullMqDispatcher implements JobDispatcher {
  private readonly queue: any;

  constructor(
    redisUrl: string,
    queueName: string,
    private readonly env: AppEnv
  ) {
    this.queue = new Queue(queueName, {
      // Publishers must fail promptly; only worker blocking connections retry indefinitely.
      connection: new (Redis as any)(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 5000, commandTimeout: 10_000 })
    });
  }

  async enqueue<TPayload>(name: JobName, payload: TPayload, idempotencyKey: string) {
    const policy = getJobExecutionPolicy(name, this.env);
    await this.queue.add(name, payload, {
      jobId: normalizeBullMqJobId(idempotencyKey),
      attempts: policy.attempts,
      backoff: {
        type: "exponential",
        delay: policy.backoffMs
      },
      removeOnComplete: 100,
      removeOnFail: 100
    });
  }
}

export function registerWorker(
  context: AppContext,
  queueName: string,
  handlers: Partial<Record<JobName, JobHandler>>
) {
  assertProductionQueueMode(context.env);
  if (context.env.QUEUE_MODE !== "bullmq") {
    return null;
  }

  const connection = new (Redis as any)(context.env.REDIS_URL, {
    maxRetriesPerRequest: null
  });

  return new Worker(
    queueName,
    async (job: WorkerJobDescriptor) => {
      const startedAt = process.hrtime.bigint();
      const handler = handlers[job.name as JobName];
      if (!handler) {
        throw new Error(`No worker handler registered for ${job.name}`);
      }

      const { requestId, jobId, attempt, attemptClass, maxAttempts } = buildWorkerObservation(job);

      try {
        await handler(job.data);
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        context.telemetry.increment("orchestra_jobs_total", {
          job_name: job.name,
          status: "completed"
        });
        context.telemetry.observeDuration("orchestra_job_duration_ms", durationMs, {
          job_name: job.name
        });
        context.telemetry.increment("orchestra_worker_attempts_total", {
          job_name: job.name,
          attempt_class: attemptClass,
          status: "completed"
        });
        context.logger.info(
          { requestId, jobId, jobName: job.name, attempt, maxAttempts, durationMs: Number(durationMs.toFixed(2)) },
          "worker_job_completed"
        );
      } catch (error) {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        context.telemetry.increment("orchestra_jobs_total", {
          job_name: job.name,
          status: "failed"
        });
        context.telemetry.observeDuration("orchestra_job_duration_ms", durationMs, {
          job_name: job.name
        });
        context.telemetry.increment("orchestra_worker_attempts_total", {
          job_name: job.name,
          attempt_class: attemptClass,
          status: "failed"
        });
        context.logger.error(
          { err: error, requestId, jobId, jobName: job.name, attempt, maxAttempts, durationMs: Number(durationMs.toFixed(2)) },
          "worker_job_failed"
        );
        throw error;
      }
    },
    { connection, concurrency: context.env.WORKER_CONCURRENCY }
  );
}
