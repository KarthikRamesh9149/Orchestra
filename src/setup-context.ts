import type { Logger } from "pino";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "./config/env.js";
import type { EmbeddingProvider, GenerationProvider, TranscriptionProvider } from "./lib/ai/provider.js";
import { createAiLimiter } from "./lib/ai-ops/ai-limits.js";
import { createSearchProvider } from "./lib/search/index.js";
import { DeepResearchService } from "./modules/deep-research/service.js";
import { BullMqDispatcher, InlineJobDispatcher } from "./lib/jobs/queue.js";
import { createJobHandlers } from "./lib/jobs/handlers.js";
import type { TelemetryService } from "./lib/observability/telemetry.js";
import type { StorageDriver } from "./lib/storage/types.js";
import { AuditService } from "./modules/audit/service.js";
import { AuthService } from "./modules/auth/service.js";
import { AuthEmailService } from "./modules/auth/auth-email.service.js";
import { BrainService } from "./modules/brain/service.js";
import { ChangeProposalService } from "./modules/changes/service.js";
import { DashboardService } from "./modules/dashboard/service.js";
import { BetaTimelineService } from "./modules/beta-timeline/beta-timeline.service.js";
import { DocumentService } from "./modules/documents/service.js";
import { LiveDocService } from "./modules/live-doc/service.js";
import { CommunicationsService } from "./modules/communications/communications.service.js";
import { ProjectOpsService } from "./modules/project-ops/service.js";
import { RecurringService } from "./modules/project-ops/recurring.service.js";
import { CalendarConnectionsService } from "./modules/project-ops/calendar-connections.service.js";
import { GoogleDriveService } from "./modules/google-drive/service.js";
import { CostEntriesService } from "./modules/project-ops/cost-entries.service.js";
import { RollupsService } from "./modules/project-ops/rollups.service.js";
import { ProjectService } from "./modules/projects/service.js";
import { ProjectResponsibilitiesService } from "./modules/projects/responsibilities.service.js";
import { ProjectContextService } from "./modules/projects/context.service.js";
import { ProjectDiagramService } from "./modules/diagrams/service.js";
import { CodingRequirementsService } from "./modules/coding-requirements/service.js";
import { ProjectDocumentGenerationService } from "./modules/documents/document-generation.service.js";
import { SocratesService } from "./modules/socrates/service.js";
import { SocratesActionService } from "./modules/socrates/actions.service.js";
import { ClientSharesService } from "./modules/client-view/client-shares.service.js";
import { ClientViewService } from "./modules/client-view/client-view.service.js";
import { AgentContextPackService } from "./modules/agent-context/service.js";
import { AgentRunMemoryService } from "./modules/agent-context/agent-runs.service.js";
import { AgentQualityDriftService } from "./modules/agent-context/quality-drift.service.js";
import { AgentFilesService } from "./modules/agent-files/service.js";
import { GitHubIntegrationService } from "./modules/github/service.js";
import { EngineeringEvidenceService } from "./modules/engineering-evidence/service.js";
import { FdeReadinessIntelligenceService } from "./modules/fde-readiness/service.js";
import { McpService } from "./modules/mcp/service.js";
import { EditorConnectorService } from "./modules/editor-connectors/service.js";
import { SuggestionsService } from "./modules/suggestions/suggestions.service.js";
import { MeService } from "./modules/me/me.service.js";
import { IntegrationManagementService } from "./modules/integrations/integrations.service.js";
import { TruthInboxService } from "./modules/truth-inbox/truth-inbox.service.js";
import { TruthChangePacketService } from "./modules/truth-inbox/truth-change-packet.service.js";
import { TruthImpactMapService } from "./modules/truth-inbox/truth-impact-map.service.js";
import { DeliveryIntelligenceService } from "./modules/delivery/service.js";
import { SocratesFeedbackService } from "./modules/socrates/feedback.service.js";
import type { AppContext } from "./types/index.js";

export function buildContext(input: {
  env: AppEnv;
  prisma: PrismaClient;
  logger: Logger;
  storage: StorageDriver;
  generationProvider: GenerationProvider;
  embeddingProvider: EmbeddingProvider;
  transcriptionProvider: TranscriptionProvider;
  telemetry: TelemetryService;
}): AppContext {
  const useInlineJobs = shouldUseInlineJobs(input.env);
  const jobs =
    useInlineJobs
      ? new InlineJobDispatcher({}, input.env)
      : new BullMqDispatcher(input.env.REDIS_URL, `${input.env.QUEUE_PREFIX}-jobs`, input.env);
  const auditService = new AuditService(input.prisma);
  const authEmailService = new AuthEmailService(input.prisma, input.env);
  const aiLimiter = createAiLimiter({
    redisUrl: useInlineJobs ? undefined : input.env.REDIS_URL,
    prefix: `${input.env.QUEUE_PREFIX}:ai-limits`,
    nodeEnv: input.env.NODE_ENV
  });
  const projectService = new ProjectService(input.prisma, auditService, jobs, input.env, authEmailService);
  const projectResponsibilitiesService = new ProjectResponsibilitiesService(
    input.prisma,
    projectService,
    auditService,
    jobs
  );
  const projectContextService = new ProjectContextService(
    input.prisma,
    input.env,
    input.storage,
    projectService,
    auditService,
    jobs,
    input.embeddingProvider,
    input.telemetry
  );
  const projectDiagramService = new ProjectDiagramService(
    input.prisma,
    input.generationProvider,
    projectService,
    auditService,
    jobs
  );
  const codingRequirementsService = new CodingRequirementsService(
    input.prisma,
    input.generationProvider,
    projectService,
    auditService,
    jobs
  );

  const brainService = new BrainService(input.prisma, input.generationProvider, jobs, projectService, auditService);
  const documentService = new DocumentService(
    input.prisma,
    input.storage,
    jobs,
    input.embeddingProvider,
    input.transcriptionProvider,
    projectService,
    auditService,
    input.telemetry,
    input.env
  );
  const documentGenerationService = new ProjectDocumentGenerationService(
    input.prisma,
    input.env,
    input.generationProvider,
    projectService,
    documentService,
    auditService,
    jobs,
    brainService,
    input.telemetry
  );
  const changeProposalService = new ChangeProposalService(
    input.prisma,
    jobs,
    projectService,
    brainService,
    auditService,
    input.env
  );
  const liveDocService = new LiveDocService(
    input.prisma,
    input.generationProvider,
    projectService,
    auditService,
    changeProposalService
  );
  const projectOpsService = new ProjectOpsService(input.prisma, projectService, auditService, jobs);
  const recurringService = new RecurringService(input.prisma, projectService, auditService, jobs);
  const calendarConnectionsService = new CalendarConnectionsService(
    input.prisma,
    input.env,
    projectService,
    auditService,
    jobs
  );
  const googleDriveService = new GoogleDriveService(
    input.prisma,
    input.env,
    projectService,
    auditService,
    jobs,
    documentService
  );
  const costEntriesService = new CostEntriesService(input.prisma, projectService, auditService, jobs);
  const rollupsService = new RollupsService(input.prisma, projectService);

  const socratesActionService = new SocratesActionService(
    input.prisma,
    projectService,
    auditService,
    jobs,
    documentGenerationService,
    projectContextService,
    projectDiagramService,
    codingRequirementsService,
    projectResponsibilitiesService,
    projectOpsService
  );
  const socratesService = new SocratesService(
    input.prisma,
    input.env,
    input.generationProvider,
    input.embeddingProvider,
    projectService,
    auditService,
    input.telemetry,
    input.logger,
    aiLimiter,
    socratesActionService
  );
  const editorConnectorService = new EditorConnectorService(
    input.prisma,
    input.env,
    projectService,
    socratesService,
    auditService
  );
  const communicationsService = new CommunicationsService(
    input.prisma,
    input.env,
    projectService,
    auditService,
    jobs,
    input.generationProvider,
    input.embeddingProvider,
    input.telemetry,
    documentService,
    aiLimiter
  );

  const clientSharesService = new ClientSharesService(
    input.prisma,
    projectService,
    auditService,
    input.env.CLIENT_SHARE_TOKEN_SECRET,
    input.env.CLIENT_PORTAL_BASE_URL ?? input.env.FRONTEND_BASE_URL ?? input.env.APP_BASE_URL
  );
  const clientViewService = new ClientViewService(
    input.prisma,
    brainService,
    clientSharesService,
    auditService
  );
  const agentContextPackService = new AgentContextPackService(input.prisma, input.env, projectService, auditService);
  const dashboardService = new DashboardService(
    input.prisma,
    projectService,
    auditService,
    input.telemetry,
    projectOpsService,
    projectResponsibilitiesService,
    projectContextService,
    projectDiagramService,
    codingRequirementsService,
    input.env,
    agentContextPackService
  );
  const betaTimelineService = new BetaTimelineService(input.prisma, projectService, auditService);
  const agentRunMemoryService = new AgentRunMemoryService(input.prisma, projectService, auditService);
  const agentQualityDriftService = new AgentQualityDriftService(input.prisma, input.env, projectService, auditService);
  const agentFilesService = new AgentFilesService(input.prisma, input.env, projectService, auditService);
  const githubIntegrationService = new GitHubIntegrationService(input.prisma, input.env, projectService, auditService);
  const meService = new MeService(input.prisma, auditService);
  const suggestionsService = new SuggestionsService(
    input.prisma,
    projectService,
    auditService,
    betaTimelineService,
    socratesService
  );
  const truthInboxService = new TruthInboxService(
    input.prisma,
    projectService,
    auditService,
    betaTimelineService,
    socratesService,
    suggestionsService,
    changeProposalService
  );
  const truthImpactMapService = new TruthImpactMapService(input.prisma);
  const truthChangePacketService = new TruthChangePacketService(input.prisma, truthInboxService, truthImpactMapService);
  const engineeringEvidenceService = new EngineeringEvidenceService(input.prisma, input.env, projectService, auditService);
  const integrationManagementService = new IntegrationManagementService(
    input.prisma,
    input.env,
    projectService,
    calendarConnectionsService,
    googleDriveService,
    githubIntegrationService
  );
  const deliveryIntelligenceService = new DeliveryIntelligenceService(
    input.prisma,
    projectService,
    auditService,
    integrationManagementService,
    agentContextPackService,
    agentRunMemoryService,
    agentQualityDriftService
  );
  const socratesFeedbackService = new SocratesFeedbackService(input.prisma, projectService, auditService);
  const fdeReadinessService = new FdeReadinessIntelligenceService(input.prisma, input.env, projectService, auditService);
  const deepResearchService = new DeepResearchService(
    input.prisma,
    input.env,
    input.generationProvider,
    input.embeddingProvider,
    createSearchProvider(input.env),
    projectService,
    auditService,
    aiLimiter,
    jobs
  );
  const mcpService = new McpService(
    input.prisma,
    input.env,
    projectService,
    agentContextPackService,
    agentRunMemoryService,
    agentFilesService,
    auditService
  );

  const services = {
    auditService,
    authService: new AuthService(input.prisma, input.env, auditService, authEmailService),
    projectService,
    projectResponsibilitiesService,
    projectContextService,
    projectDiagramService,
    codingRequirementsService,
    documentService,
    documentGenerationService,
    brainService,
    changeProposalService,
    liveDocService,
    socratesService,
    socratesActionService,
    dashboardService,
    betaTimelineService,
    communicationsService,
    projectOpsService,
    recurringService,
    calendarConnectionsService,
    googleDriveService,
    costEntriesService,
    rollupsService,
    clientSharesService,
    clientViewService,
    agentContextPackService,
    agentRunMemoryService,
    agentQualityDriftService,
    agentFilesService,
    githubIntegrationService,
    meService,
    suggestionsService,
    truthInboxService,
    truthImpactMapService,
    truthChangePacketService,
    deliveryIntelligenceService,
    socratesFeedbackService,
    integrationManagementService,
    engineeringEvidenceService,
    fdeReadinessService,
    mcpService,
    editorConnectorService,
    deepResearchService
  };

  if (jobs instanceof InlineJobDispatcher) {
    jobs.handlers = createJobHandlers({ services });
  }

  return {
    ...input,
    jobs,
    aiLimiter,
    services
  };
}

export function shouldUseInlineJobs(env: AppEnv) {
  return env.QUEUE_MODE === "inline" || (env.ORCHESTRA_PROFILE === "mvp_beta" && env.STORAGE_DRIVER === "local");
}
