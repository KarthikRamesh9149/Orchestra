import { mkdir, writeFile } from "node:fs/promises";
import { Queue, QueueEvents, Worker } from "bullmq";
import Redis from "ioredis";

function requireLocalRedis(value: string | undefined) {
  const url = new URL(value ?? "redis://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("worker recovery proof requires disposable local Redis");
  }
  return url.toString();
}

async function main() {
  const redisUrl = requireLocalRedis(process.env.RELEASE_TEST_REDIS_URL);
  const queueName = `orchestra-fix33-${Date.now()}`;
  const connection = new (Redis as any)(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(queueName, { connection });
  const events = new QueueEvents(queueName, { connection: new (Redis as any)(redisUrl, { maxRetriesPerRequest: null }) });
  await events.waitUntilReady();
  const attempts: string[] = [];
  const firstWorker = new Worker(queueName, async (job: { attemptsMade: number }) => {
    attempts.push(`worker-1-attempt-${job.attemptsMade + 1}`);
    throw new Error("synthetic recoverable interruption");
  }, { connection: new (Redis as any)(redisUrl, { maxRetriesPerRequest: null }), concurrency: 1 });

  const job = await queue.add("recovery-proof", { synthetic: true }, {
    jobId: `fix33-${Date.now()}`,
    attempts: 3,
    backoff: { type: "fixed", delay: 100 },
    removeOnComplete: false,
    removeOnFail: false
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("first worker did not record the recoverable failure")), 10_000);
    firstWorker.once("failed", () => { clearTimeout(timeout); resolve(); });
  });
  await firstWorker.close();

  const secondWorker = new Worker(queueName, async (retriedJob: { attemptsMade: number }) => {
    attempts.push(`worker-2-attempt-${retriedJob.attemptsMade + 1}`);
    return { recovered: true };
  }, { connection: new (Redis as any)(redisUrl, { maxRetriesPerRequest: null }), concurrency: 1 });
  const result = await job.waitUntilFinished(events, 15_000);
  if (result?.recovered !== true || attempts.length !== 2 || !attempts[1]?.includes("attempt-2")) {
    throw new Error(`worker did not resume on attempt 2: ${JSON.stringify({ result, attempts })}`);
  }

  const report = { ok: true, liveProof: true, target: "disposable_local_redis", attempts, recoveredAfterRestart: true };
  await mkdir("artifacts/ops", { recursive: true });
  await writeFile("artifacts/ops/fix33-worker-recovery.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await secondWorker.close();
  await queue.obliterate({ force: true });
  await events.close();
  await queue.close();
  connection.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? `Fix 33 worker recovery failed: ${error.message}` : String(error));
    process.exit(1);
  });
