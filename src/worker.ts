import { getEnv } from "./config/env.js";
import { createPrismaClient } from "./db/prisma.js";
import { createEmbeddingProvider, createGenerationProvider, createTranscriptionProvider } from "./lib/ai/index.js";
import { createJobHandlers } from "./lib/jobs/handlers.js";
import { registerWorker } from "./lib/jobs/queue.js";
import { createLogger } from "./lib/logging/logger.js";
import { TelemetryService } from "./lib/observability/telemetry.js";
import { createStorageDriver } from "./lib/storage/index.js";
import { buildContext } from "./setup-context.js";

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

registerWorker(context, `${env.QUEUE_PREFIX}-jobs`, createJobHandlers(context));

logger.info({ queuePrefix: env.QUEUE_PREFIX }, "worker_started");
