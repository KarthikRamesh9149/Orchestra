import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { JobDispatcher, JobName } from "./types.js";
import { JobNames } from "./types.js";

export interface DesktopClaim {
  id: string;
  name: JobName;
  payload: unknown;
  owner_token: string;
  fence: bigint;
  attempts: number;
}

/** Durable at-least-once queue. Handler effects still require their own
 * transactional idempotency/fencing; queue acknowledgement is not exactly-once. */
export class PostgresJobDispatcher implements JobDispatcher {
  constructor(private readonly db: PrismaClient, private readonly leaseMs = 30_000) {
    if (!Number.isInteger(leaseMs) || leaseMs < 100 || leaseMs > 300_000) throw new Error("Invalid job lease");
  }

  async enqueue<T>(name: JobName, payload: T, key: string) {
    if (!Object.values(JobNames).includes(name) || !key || key.length > 512) throw new Error("Invalid job identity");
    const json = JSON.stringify(payload);
    if (!json || Buffer.byteLength(json) > 1024 * 1024) throw new Error("Invalid job payload");
    // A reused identity must never silently replace a previously queued payload.
    const rows = await this.db.$queryRaw<Array<{id:string}>>`
      INSERT INTO desktop_jobs(name,idempotency_key,payload) VALUES (${name},${key},${json}::jsonb)
      ON CONFLICT(name,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
      WHERE desktop_jobs.payload=EXCLUDED.payload RETURNING id`;
    if (!rows.length) throw new Error("Job idempotency key reused with a different payload");
  }

  async claim(): Promise<DesktopClaim | null> {
    const owner = randomUUID();
    // Do not silently restart an abandoned legacy handler: not every imported
    // service is effect-fenced yet. Reconciliation makes it explicitly retryable.
    await this.db.$executeRaw`
      UPDATE desktop_jobs SET status='failed', owner_token=NULL, lease_until=NULL,
        failure_code='worker_lease_expired', updated_at=now()
      WHERE id IN (SELECT id FROM desktop_jobs WHERE status='running' AND lease_until < now() FOR UPDATE SKIP LOCKED)`;
    const jobs = await this.db.$queryRaw<DesktopClaim[]>`
      WITH candidate AS (
        SELECT id FROM desktop_jobs WHERE status='queued' AND available_at<=now() AND attempts<max_attempts
        ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE desktop_jobs j SET status='running',owner_token=${owner}::uuid,fence=fence+1,
        lease_until=now()+${this.leaseMs}*interval '1 millisecond',attempts=attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.name,j.payload,j.owner_token,j.fence,j.attempts`;
    return jobs[0] ?? null;
  }

  async heartbeat(job: DesktopClaim) {
    return (await this.db.$executeRaw`UPDATE desktop_jobs SET lease_until=now()+${this.leaseMs}*interval '1 millisecond',updated_at=now()
      WHERE id=${job.id}::uuid AND owner_token=${job.owner_token}::uuid AND fence=${job.fence}
      AND status='running' AND lease_until>now()`) === 1;
  }

  async complete(job: DesktopClaim) {
    return (await this.db.$executeRaw`UPDATE desktop_jobs SET status='completed',owner_token=NULL,lease_until=NULL,updated_at=now()
      WHERE id=${job.id}::uuid AND owner_token=${job.owner_token}::uuid AND fence=${job.fence}
      AND status='running' AND lease_until>now()`) === 1;
  }

  async fail(job: DesktopClaim, failureCode='handler_failed') {
    if(!/^(handler_failed|ai_request_budget_exceeded|embedding_not_configured|ai_not_configured|ai_provider_failed|ai_busy|ai_revoked|P\d{4}(?:_[A-Z0-9]{5})?|handler_type_error|handler_validation_error)$/.test(failureCode))failureCode='handler_failed';
    return (await this.db.$executeRaw`UPDATE desktop_jobs SET status='failed',owner_token=NULL,lease_until=NULL,
      failure_code=${failureCode},updated_at=now()
      WHERE id=${job.id}::uuid AND owner_token=${job.owner_token}::uuid AND fence=${job.fence}
      AND status='running' AND lease_until>now()`) === 1;
  }

  async cancel(id: string) {
    await this.db.$executeRaw`INSERT INTO desktop_job_cancellations(job_id) SELECT id FROM desktop_jobs
      WHERE id=${id}::uuid AND status IN ('queued','running','failed') ON CONFLICT DO NOTHING`;
    return (await this.db.$executeRaw`UPDATE desktop_jobs SET status='cancelled',owner_token=NULL,lease_until=NULL,
      fence=fence+1,updated_at=now() WHERE id=${id}::uuid AND status IN ('queued','running','failed')`) === 1;
  }

  /** Caller must authorize the retry and verify the handler's effect idempotency. */
  async retryFailed(id: string) {
    return this.db.$transaction(async tx=>{
    const changed=await tx.$executeRaw`UPDATE desktop_jobs SET status='queued',failure_code=NULL,
      available_at=now()+LEAST(30000,1000*power(2,attempts))*interval '1 millisecond',updated_at=now()
      WHERE id=${id}::uuid AND status='failed' AND attempts<max_attempts`;
    if(changed!==1)return false;
    await tx.$executeRaw`DELETE FROM desktop_job_cancellations WHERE job_id=${id}::uuid`;
    await tx.$executeRaw`UPDATE deep_research_runs r SET status='queued',progress_stage='queued',error_message=NULL,completed_at=NULL
      FROM desktop_jobs j WHERE j.id=${id}::uuid AND j.name='deep_research_run' AND r.id::text=j.payload->>'runId'
      AND r.project_id::text=j.payload->>'projectId' AND r.status='failed'`;
    await tx.$executeRaw`UPDATE document_versions v SET status='pending',processed_at=NULL
      FROM desktop_jobs j WHERE j.id=${id}::uuid AND j.name IN ('parse_document','chunk_document','embed_document_chunks')
      AND v.id::text=j.payload->>'documentVersionId' AND v.parse_revision::text=j.payload->>'parseRevision' AND v.status='failed'`;
    return true;
    });
  }
}
