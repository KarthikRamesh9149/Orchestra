import type { AppEnv } from "../../config/env.js";
import { JobNames, type JobName } from "./types.js";

const HEAVY_JOBS = new Set<JobName>([
  JobNames.parseDocument,
  JobNames.chunkDocument,
  JobNames.embedDocumentChunks,
  JobNames.generateSourcePackage,
  JobNames.generateClarifiedBrief,
  JobNames.generateBrainGraph,
  JobNames.generateProductBrain,
  JobNames.generateLiveDoc,
  JobNames.applyAcceptedChange,
  JobNames.syncCommunicationConnector,
  JobNames.ingestCommunicationBatch,
  JobNames.syncCalendarConnection,
  JobNames.syncGoogleDriveConnection,
  JobNames.deepResearchRun
]);

const LIGHT_JOBS = new Set<JobName>([
  JobNames.indexCommunicationMessage,
  JobNames.indexProjectContextEntry,
  JobNames.classifyMessageInsight,
  JobNames.classifyThreadInsight,
  JobNames.generateChangeProposalFromInsight,
  JobNames.precomputeSocratesSuggestions,
  JobNames.refreshDashboardSnapshot
]);

export interface JobExecutionPolicy {
  attempts: number;
  backoffMs: number;
  heavy: boolean;
  concurrencyGroup: "document" | "brain" | "communication" | "dashboard" | "project_ops" | "default";
}

export function getJobExecutionPolicy(jobName: JobName, env: AppEnv): JobExecutionPolicy {
  const heavy = HEAVY_JOBS.has(jobName);
  return {
    attempts: heavy ? env.JOB_DEFAULT_ATTEMPTS : Math.max(1, Math.min(env.JOB_DEFAULT_ATTEMPTS, 2)),
    backoffMs: env.JOB_DEFAULT_BACKOFF_MS,
    heavy,
    concurrencyGroup: getConcurrencyGroup(jobName)
  };
}

export function assertProductionQueueMode(env: AppEnv) {
  if (env.DEPLOYMENT_ENV === "production" && env.QUEUE_MODE === "inline") {
    throw new Error("Production must use QUEUE_MODE=bullmq; inline heavy jobs are disabled for pilot reliability");
  }
}

function getConcurrencyGroup(jobName: JobName): JobExecutionPolicy["concurrencyGroup"] {
  if (
    jobName === JobNames.parseDocument ||
    jobName === JobNames.chunkDocument ||
    jobName === JobNames.embedDocumentChunks
  ) {
    return "document";
  }
  if (
    jobName === JobNames.generateSourcePackage ||
    jobName === JobNames.generateClarifiedBrief ||
    jobName === JobNames.generateBrainGraph ||
    jobName === JobNames.generateProductBrain ||
    jobName === JobNames.generateLiveDoc ||
    jobName === JobNames.applyAcceptedChange
  ) {
    return "brain";
  }
  if (
    jobName === JobNames.syncCommunicationConnector ||
    jobName === JobNames.ingestCommunicationBatch ||
    jobName === JobNames.indexCommunicationMessage ||
    jobName === JobNames.indexProjectContextEntry ||
    jobName === JobNames.classifyMessageInsight ||
    jobName === JobNames.classifyThreadInsight ||
    jobName === JobNames.generateChangeProposalFromInsight
  ) {
    return "communication";
  }
  if (jobName === JobNames.refreshDashboardSnapshot) {
    return "dashboard";
  }
  if (jobName === JobNames.syncCalendarConnection || jobName === JobNames.syncGoogleDriveConnection) {
    return "project_ops";
  }
  if (jobName === JobNames.deepResearchRun) {
    return "brain";
  }
  return LIGHT_JOBS.has(jobName) ? "default" : "default";
}
