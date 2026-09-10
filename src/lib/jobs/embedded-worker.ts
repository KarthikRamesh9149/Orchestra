import { createJobHandlers } from "./handlers.js";
import { registerWorker } from "./queue.js";
import type { AppContext } from "../../types/index.js";

export function startEmbeddedWorker(context: AppContext) {
  if (!context.env.ORCHESTRA_EMBED_WORKER) return null;

  const worker = registerWorker(
    context,
    `${context.env.QUEUE_PREFIX}-jobs`,
    createJobHandlers(context)
  );
  if (!worker) {
    throw new Error("ORCHESTRA_EMBED_WORKER requires QUEUE_MODE=bullmq");
  }
  worker.on("error", (error: Error) => {
    context.logger.error({ err: error }, "embedded_worker_error");
  });
  return worker;
}
