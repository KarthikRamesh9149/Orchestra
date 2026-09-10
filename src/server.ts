import { getEnv } from "./config/env.js";
import { createPrismaClient, measureStagingDatabaseLatency, startAfterDatabaseReady } from "./db/prisma.js";
import { createEmbeddingProvider, createGenerationProvider, createTranscriptionProvider } from "./lib/ai/index.js";
import { createStorageDriver } from "./lib/storage/index.js";
import { createLogger } from "./lib/logging/logger.js";
import { TelemetryService } from "./lib/observability/telemetry.js";
import { startEmbeddedWorker } from "./lib/jobs/embedded-worker.js";
import { buildContext } from "./setup-context.js";
import { buildApp } from "./app/build-app.js";

const env = getEnv();
const prisma = createPrismaClient();
const logger = createLogger(env.LOG_LEVEL);
const telemetry = new TelemetryService();

if (env.MVP_BETA_FREE_TIER_MODE) {
  logger.warn(
    {
      deploymentEnv: env.DEPLOYMENT_ENV,
      limitations: ["volume_backed_local_storage", "encrypted_file_vault", "no_external_trace_error_uptime_sinks"]
    },
    "free_tier_beta_production_controls_active"
  );
}

const context = buildContext({
  env,
  prisma,
  logger,
  storage: createStorageDriver(env),
  generationProvider: createGenerationProvider(env),
  embeddingProvider: createEmbeddingProvider(env),
  transcriptionProvider: createTranscriptionProvider(env),
  telemetry
});

const app = await buildApp(context);
const databaseReadyStarted = Date.now();
await startAfterDatabaseReady(() => prisma.$queryRaw`SELECT 1`, async () => {
  logger.info({ elapsedMs: Date.now() - databaseReadyStarted }, "database_ready_before_serving");
  const embeddedWorker = startEmbeddedWorker(context);
  if (embeddedWorker) {
    app.addHook("onClose", async () => {
      await embeddedWorker.close();
    });
  }

  await app.listen({
    port: env.PORT,
    host: env.HOST
  });

  logger.info({ port: env.PORT, host: env.HOST }, "server_started");
  void measureStagingDatabaseLatency(env.DEPLOYMENT_ENV, () => prisma.$queryRaw`SELECT 1`)
    .then((result) => { if (result) logger.info(result, "staging_database_round_trip"); });
  if (embeddedWorker) {
    logger.info({ queuePrefix: env.QUEUE_PREFIX, concurrency: env.WORKER_CONCURRENCY }, "embedded_worker_started");
  }
});
