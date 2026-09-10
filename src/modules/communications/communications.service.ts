import type { CommunicationProvider, PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import type { EmbeddingProvider, GenerationProvider } from "../../lib/ai/provider.js";
import type { AiLimiter } from "../../lib/ai-ops/ai-limits.js";
import { CredentialVault } from "../../lib/communications/credential-vault.js";
import type { NormalizedCommunicationBatch } from "../../lib/communications/provider-normalized-types.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import type { TelemetryService } from "../../lib/observability/telemetry.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import type { DocumentService } from "../documents/service.js";
import { CommunicationProposalsService } from "./communication-proposals.service.js";
import { ConnectorsService } from "./connectors.service.js";
import { ImpactResolverService } from "./impact-resolver.service.js";
import { MessageIngestionService } from "./message-ingestion.service.js";
import { MessageIndexingService } from "./message-indexing.service.js";
import { MessageInsightsService } from "./message-insights.service.js";
import { MessageNormalizerService } from "./message-normalizer.service.js";
import type { CommunicationProviderAdapter } from "./providers/provider.interface.js";
import { ManualImportProvider } from "./providers/manual.provider.js";
import { SlackProvider } from "./providers/slack.provider.js";
import { GmailProvider } from "./providers/gmail.provider.js";
import { OutlookProvider } from "./providers/outlook.provider.js";
import { TeamsProvider } from "./providers/teams.provider.js";
import { NotionProvider } from "./providers/notion.provider.js";
import { WhatsAppBusinessProvider } from "./providers/whatsapp-business.provider.js";
import { FirefliesProvider } from "./providers/fireflies.provider.js";
import { ClickUpProvider } from "./providers/clickup.provider.js";
import { GranolaProvider } from "./providers/granola.provider.js";
import { ZohoMailProvider } from "./providers/zoho-mail.provider.js";
import { ZohoCliqProvider } from "./providers/zoho-cliq.provider.js";
import { ZohoCrmProvider } from "./providers/zoho-crm.provider.js";
import { SyncService } from "./sync.service.js";
import { ThreadInsightsService } from "./thread-insights.service.js";
import { TimelineService } from "./timeline.service.js";
import { isMvpBetaMode } from "../../lib/beta/policy.js";

export class CommunicationsService {
  private readonly prisma: PrismaClient;
  private readonly auditService: AuditService;
  readonly normalizer: MessageNormalizerService;
  readonly ingestion: MessageIngestionService;
  readonly indexing: MessageIndexingService;
  readonly connectors: ConnectorsService;
  readonly sync: SyncService;
  readonly timeline: TimelineService;
  readonly proposals: CommunicationProposalsService;
  readonly impactResolver: ImpactResolverService;
  readonly messageInsights: MessageInsightsService;
  readonly threadInsights: ThreadInsightsService;
  readonly providers: Map<string, CommunicationProviderAdapter>;

  constructor(
    prisma: PrismaClient,
    env: AppEnv,
    projectService: ProjectService,
    auditService: AuditService,
    jobs: JobDispatcher,
    generationProvider: GenerationProvider,
    embeddingProvider: EmbeddingProvider,
    telemetry: TelemetryService,
    documentService?: DocumentService,
    aiLimiter?: AiLimiter
  ) {
    this.prisma = prisma;
    this.auditService = auditService;
    const credentialVault = new CredentialVault(env);
    const providers = new Map<string, CommunicationProviderAdapter>([
      ["manual_import", new ManualImportProvider()],
      ["slack", new SlackProvider(env)],
      ["gmail", new GmailProvider(env)],
      ["outlook", new OutlookProvider(env)],
      ["microsoft_teams", new TeamsProvider(env)],
      ["notion", new NotionProvider(env)],
      ["whatsapp_business", new WhatsAppBusinessProvider(env)],
      ["fireflies_ai", new FirefliesProvider(env)],
      ["clickup", new ClickUpProvider(env)],
      ["granola", new GranolaProvider(env)],
      ["zoho_mail", new ZohoMailProvider(env)],
      ["zoho_cliq", new ZohoCliqProvider(env)],
      ["zoho_crm", new ZohoCrmProvider(env)]
    ]);

    this.providers = providers;
    this.normalizer = new MessageNormalizerService();
    this.ingestion = new MessageIngestionService(prisma, jobs, isMvpBetaMode(env));
    this.indexing = new MessageIndexingService(prisma, embeddingProvider, auditService, jobs, env);
    this.connectors = new ConnectorsService(prisma, env, projectService, auditService, jobs, credentialVault, providers, telemetry);
    this.sync = new SyncService(prisma, env, projectService, auditService, jobs, credentialVault, providers, this.ingestion, telemetry, documentService);
    this.connectors.setSyncService(this.sync);
    this.timeline = new TimelineService(prisma, projectService, auditService);
    this.impactResolver = new ImpactResolverService(prisma);
    this.proposals = new CommunicationProposalsService(prisma, projectService, auditService, jobs, env);
    this.messageInsights = new MessageInsightsService(
      prisma,
      generationProvider,
      projectService,
      auditService,
      jobs,
      this.impactResolver,
      this.proposals,
      telemetry,
      env,
      aiLimiter
    );
    this.threadInsights = new ThreadInsightsService(
      prisma,
      generationProvider,
      projectService,
      auditService,
      jobs,
      this.impactResolver,
      this.proposals,
      telemetry,
      env,
      aiLimiter
    );
  }

  async importManualBatch(input: {
    projectId: string;
    actorUserId: string;
    accountLabel: string;
    batch: Omit<NormalizedCommunicationBatch, "projectId" | "connectorId">;
  }) {
    return this.importProviderBatch({
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      accountLabel: input.accountLabel,
      batch: input.batch
    });
  }

  async importProviderBatch(input: {
    projectId: string;
    actorUserId: string;
    accountLabel: string;
    batch: Omit<NormalizedCommunicationBatch, "projectId" | "connectorId">;
  }) {
    const connected = await this.connectors.connect(input.projectId, input.batch.provider, input.actorUserId);
    if (input.accountLabel.trim().length > 0) {
      await this.prisma.communicationConnector.update({
        where: { id: connected.connectorId },
        data: { accountLabel: input.accountLabel.trim() }
      });
    }
    const normalized = this.normalizer.normalizeBatch({
      ...input.batch,
      projectId: input.projectId,
      connectorId: connected.connectorId
    });

    const result = await this.ingestion.ingestNormalizedBatch(normalized);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { orgId: true }
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      eventType: input.batch.provider === "manual_import" ? "communication_manual_imported" : "communication_provider_imported",
      entityType: "communication_thread",
      entityId: result.threadId,
      payload: {
        connectorId: connected.connectorId,
        provider: input.batch.provider,
        createdMessageCount: result.createdMessageCount,
        updatedRevisionCount: result.updatedRevisionCount
      }
    });
    return {
      connectorId: connected.connectorId,
      threadId: result.threadId,
      messageIds: result.messageIds,
      createdMessageCount: result.createdMessageCount,
      updatedRevisionCount: result.updatedRevisionCount,
      indexed: result.indexedMessageCount > 0
    };
  }

  getAdapter(provider: CommunicationProvider) {
    return this.providers.get(provider);
  }
}
