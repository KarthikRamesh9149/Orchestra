import { createHash } from "node:crypto";
import { MockEmbeddingProvider, MockGenerationProvider } from "../../src/lib/ai/mock.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { CommunicationProposalsService } from "../../src/modules/communications/communication-proposals.service.js";
import { ImpactResolverService } from "../../src/modules/communications/impact-resolver.service.js";
import { MessageInsightsService } from "../../src/modules/communications/message-insights.service.js";
import { ThreadInsightsService } from "../../src/modules/communications/thread-insights.service.js";
import { ProjectService } from "../../src/modules/projects/service.js";
import { SocratesService } from "../../src/modules/socrates/service.js";
import type { ProjectFixtureKey } from "./types.js";

type Store = {
  projects: Map<string, any>;
  projectMembers: Map<string, any>;
  documents: Map<string, any>;
  documentVersions: Map<string, any>;
  documentSections: Map<string, any>;
  documentChunks: Map<string, any>;
  projectNotionResources: Map<string, any>;
  artifactVersions: Map<string, any>;
  brainNodes: Map<string, any>;
  brainEdges: Map<string, any>;
  brainSectionLinks: Map<string, any>;
  projectDiagrams: Map<string, any>;
  projectCodingRequirements: Map<string, any>;
  projectContextEntries: Map<string, any>;
  projectContextChunks: Map<string, any>;
  projectContextAttachments: Map<string, any>;
  projectResponsibilities: Map<string, any>;
  communicationConnectors: Map<string, any>;
  communicationThreads: Map<string, any>;
  communicationMessages: Map<string, any>;
  communicationMessageChunks: Map<string, any>;
  communicationMessageRevisions: Map<string, any>;
  messageInsights: Map<string, any>;
  threadInsights: Map<string, any>;
  specChangeProposals: Map<string, any>;
  specChangeLinks: Map<string, any>;
  decisionRecords: Map<string, any>;
  dashboardSnapshots: Map<string, any>;
  agentRuns: Map<string, any>;
  agentQualityReviews: Map<string, any>;
  jobRuns: Map<string, any>;
  auditEvents: any[];
};

type FixtureMessageDefinition = {
  projectFixture?: ProjectFixtureKey;
  threadSubject: string;
  senderLabel: string;
  senderEmail?: string | null;
  sentAt: string;
  bodyText: string;
  provider?: "manual_import" | "slack" | "gmail" | "outlook" | "microsoft_teams" | "teams" | "whatsapp_business" | "whatsapp" | "fireflies_ai" | "clickup" | "granola";
  messageType?: "user" | "system" | "bot" | "file_share" | "note" | "other";
};

function fixtureUuid(namespace: string, key: string) {
  const digest = createHash("md5").update(`${namespace}:${key}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function makeStore(): Store {
  return {
    projects: new Map(),
    projectMembers: new Map(),
    documents: new Map(),
    documentVersions: new Map(),
    documentSections: new Map(),
    documentChunks: new Map(),
    projectNotionResources: new Map(),
    artifactVersions: new Map(),
    brainNodes: new Map(),
    brainEdges: new Map(),
    brainSectionLinks: new Map(),
    projectDiagrams: new Map(),
    projectCodingRequirements: new Map(),
    projectContextEntries: new Map(),
    projectContextChunks: new Map(),
    projectContextAttachments: new Map(),
    projectResponsibilities: new Map(),
    communicationConnectors: new Map(),
    communicationThreads: new Map(),
    communicationMessages: new Map(),
    communicationMessageChunks: new Map(),
    communicationMessageRevisions: new Map(),
    messageInsights: new Map(),
    threadInsights: new Map(),
    specChangeProposals: new Map(),
    specChangeLinks: new Map(),
    decisionRecords: new Map(),
    dashboardSnapshots: new Map(),
    agentRuns: new Map(),
    agentQualityReviews: new Map(),
    jobRuns: new Map(),
    auditEvents: []
  };
}

export const MESSAGE_FIXTURES: Record<string, FixtureMessageDefinition> = {
  mi_req_assignment_change: {
    projectFixture: "project_alpha",
    threadSubject: "Assignment approvals",
    senderLabel: "Client PM",
    senderEmail: "client@example.com",
    sentAt: "2026-04-21T09:00:00.000Z",
    bodyText: "Please require explicit manager approval before any assignment activation.",
    provider: "slack"
  },
  mi_req_weekly_reporting: {
    projectFixture: "project_alpha",
    threadSubject: "Reporting updates",
    senderLabel: "Client PM",
    senderEmail: "client@example.com",
    sentAt: "2026-04-21T09:05:00.000Z",
    bodyText: "Need weekly reporting for managers instead of monthly summaries.",
    provider: "gmail"
  },
  mi_decision_digest_email: {
    projectFixture: "project_beta",
    threadSubject: "Notification decision",
    senderLabel: "Founder",
    sentAt: "2026-04-21T09:10:00.000Z",
    bodyText: "We decided to ship Friday digest emails instead of individual alerts.",
    provider: "gmail"
  },
  mi_approval_digest_email: {
    projectFixture: "project_beta",
    threadSubject: "Notification approval",
    senderLabel: "Founder",
    sentAt: "2026-04-21T09:12:00.000Z",
    bodyText: "Approved: go ahead with Friday digest emails for launch.",
    provider: "gmail"
  },
  mi_contradiction_sms_launch: {
    projectFixture: "project_gamma",
    threadSubject: "Launch contradiction",
    senderLabel: "PM",
    sentAt: "2026-04-21T09:15:00.000Z",
    bodyText: "Not email alerts but SMS alerts should be the launch default.",
    provider: "slack"
  },
  mi_blocker_sso: {
    projectFixture: "project_gamma",
    threadSubject: "Launch blocker",
    senderLabel: "Engineering Lead",
    sentAt: "2026-04-21T09:20:00.000Z",
    bodyText: "We are blocked until the SSO approval flow is fixed.",
    provider: "slack"
  },
  mi_risk_sso_load: {
    projectFixture: "project_gamma",
    threadSubject: "SSO risk",
    senderLabel: "Engineering Lead",
    sentAt: "2026-04-21T09:25:00.000Z",
    bodyText: "There is a risk the SSO gate will fail under launch load.",
    provider: "slack"
  },
  mi_action_needed_followup: {
    projectFixture: "project_gamma",
    threadSubject: "Action needed",
    senderLabel: "PM",
    sentAt: "2026-04-21T09:30:00.000Z",
    bodyText: "Action needed: confirm whether launch should stay behind the SSO gate.",
    provider: "slack"
  },
  mi_clarify_reporting_scope: {
    projectFixture: "project_alpha",
    threadSubject: "Clarify reporting",
    senderLabel: "Client PM",
    sentAt: "2026-04-21T09:35:00.000Z",
    bodyText: "Can you clarify whether weekly reporting includes manager exports?",
    provider: "gmail"
  },
  mi_info_status_update: {
    projectFixture: "project_alpha",
    threadSubject: "Status update",
    senderLabel: "PM",
    sentAt: "2026-04-21T09:40:00.000Z",
    bodyText: "FYI the weekly reporting mocks are ready for review.",
    provider: "slack"
  },
  mi_amb_maybe_reporting: {
    projectFixture: "project_alpha",
    threadSubject: "Exploration",
    senderLabel: "Client PM",
    sentAt: "2026-04-21T09:45:00.000Z",
    bodyText: "Maybe later we could explore weekly reporting for managers.",
    provider: "slack"
  },
  mi_amb_can_we_explore: {
    projectFixture: "project_alpha",
    threadSubject: "Exploration",
    senderLabel: "Client PM",
    sentAt: "2026-04-21T09:46:00.000Z",
    bodyText: "Can we explore whether weekly reporting might be useful?",
    provider: "slack"
  },
  mi_amb_perhaps_client_portal: {
    projectFixture: "project_beta",
    threadSubject: "Exploration",
    senderLabel: "Founder",
    sentAt: "2026-04-21T09:47:00.000Z",
    bodyText: "Perhaps we could add a client portal later, but not urgent.",
    provider: "gmail"
  },
  mi_amb_would_be_nice: {
    projectFixture: "project_gamma",
    threadSubject: "Exploration",
    senderLabel: "PM",
    sentAt: "2026-04-21T09:48:00.000Z",
    bodyText: "It would be nice to explore SMS alerts sometime.",
    provider: "slack"
  },
  mi_fireflies_maybe_reporting: {
    projectFixture: "project_alpha",
    threadSubject: "Client Kickoff",
    senderLabel: "Fireflies.ai transcript",
    sentAt: "2026-05-12T10:12:04.000Z",
    bodyText: "[00:12:04] Sarah Client: Maybe later we could explore weekly reporting, but let's not decide today.",
    provider: "fireflies_ai"
  },
  mi_teams_client_approval_launch_review: {
    projectFixture: "project_notion_teams",
    threadSubject: "Teams Launch Review",
    senderLabel: "Priya Product",
    sentAt: "2026-05-14T09:00:00.000Z",
    bodyText:
      "Microsoft Teams approval: client approved manager approval launch only if the Notion launch checklist keeps QA owner and rollback steps visible. Treat this as evidence for review, not accepted Product Brain truth.",
    provider: "microsoft_teams"
  },
  mi_fireflies_weekly_reporting_approved: {
    projectFixture: "project_alpha",
    threadSubject: "Client Kickoff",
    senderLabel: "Fireflies.ai transcript",
    sentAt: "2026-05-12T10:14:04.000Z",
    bodyText: "[00:14:04] Sarah Client: Final decision: change reporting from monthly to weekly for managers.",
    provider: "fireflies_ai"
  },
  mi_fireflies_action_item_followup: {
    projectFixture: "project_alpha",
    threadSubject: "Client Kickoff",
    senderLabel: "Fireflies.ai transcript",
    sentAt: "2026-05-12T10:16:04.000Z",
    bodyText: "[00:16:04] Sarah Client: Action needed: please follow up with the reporting rollout timeline.",
    provider: "fireflies_ai"
  },
  mi_fireflies_approval_reporting: {
    projectFixture: "project_alpha",
    threadSubject: "Client Kickoff",
    senderLabel: "Fireflies.ai transcript",
    sentAt: "2026-05-12T10:18:04.000Z",
    bodyText: "[00:18:04] Sarah Client: Approved: go ahead with weekly reporting for managers for launch.",
    provider: "fireflies_ai"
  },
  mi_fireflies_invalid_refs_noise: {
    projectFixture: "project_beta",
    threadSubject: "Unrelated Fireflies Meeting",
    senderLabel: "Fireflies.ai transcript",
    sentAt: "2026-05-12T10:20:04.000Z",
    bodyText: "[00:20:04] Sarah Client: Need a redesign of the holiday microsite, not this notification system.",
    provider: "fireflies_ai"
  },
  mi_clickup_acceptance_reporting: {
    projectFixture: "project_alpha",
    threadSubject: "ClickUp task: reporting launch acceptance",
    senderLabel: "Client PM",
    sentAt: "2026-05-13T11:00:00.000Z",
    bodyText: "Approved: go ahead with weekly reporting for managers for launch.",
    provider: "clickup"
  },
  mi_clickup_status_update_reporting: {
    projectFixture: "project_alpha",
    threadSubject: "ClickUp task: reporting implementation",
    senderLabel: "Delivery Lead",
    sentAt: "2026-05-13T11:05:00.000Z",
    bodyText: "Status update: weekly reporting implementation moved to in progress.",
    provider: "clickup"
  },
  mi_clickup_blocker_reporting: {
    projectFixture: "project_alpha",
    threadSubject: "ClickUp task: reporting blocker",
    senderLabel: "Engineer",
    sentAt: "2026-05-13T11:10:00.000Z",
    bodyText: "Blocked until the weekly reporting export schema is confirmed.",
    provider: "clickup"
  },
  mi_req_remove_direct_assignment: {
    projectFixture: "project_alpha",
    threadSubject: "Assignment change",
    senderLabel: "Client PM",
    sentAt: "2026-04-21T09:49:00.000Z",
    bodyText: "Remove direct assignment and force manager approval on every activation.",
    provider: "slack"
  },
  mi_req_voice_notes: {
    projectFixture: "project_alpha",
    threadSubject: "Voice input",
    senderLabel: "Founder",
    sentAt: "2026-04-21T09:50:00.000Z",
    bodyText: "We need voice note input for early idea capture in the product brain.",
    provider: "gmail"
  },
  mi_decision_thread_a: {
    projectFixture: "project_beta",
    threadSubject: "Digest thread",
    senderLabel: "Founder",
    sentAt: "2026-04-21T09:51:00.000Z",
    bodyText: "We discussed the options for launch notifications.",
    provider: "gmail"
  },
  mi_decision_thread_b: {
    projectFixture: "project_beta",
    threadSubject: "Digest thread",
    senderLabel: "Founder",
    sentAt: "2026-04-21T09:52:00.000Z",
    bodyText: "Let's go with Friday digest emails.",
    provider: "gmail"
  },
  mi_approval_thread_a: {
    projectFixture: "project_beta",
    threadSubject: "Approval thread",
    senderLabel: "Founder",
    sentAt: "2026-04-21T09:53:00.000Z",
    bodyText: "The digest email option looks best.",
    provider: "gmail"
  },
  mi_approval_thread_b: {
    projectFixture: "project_beta",
    threadSubject: "Approval thread",
    senderLabel: "Founder",
    sentAt: "2026-04-21T09:54:00.000Z",
    bodyText: "Approved, ship the digest email flow.",
    provider: "gmail"
  },
  mi_invalid_refs_noise: {
    projectFixture: "project_beta",
    threadSubject: "Off-topic",
    senderLabel: "Client PM",
    sentAt: "2026-04-21T09:55:00.000Z",
    bodyText: "Need a redesign of the holiday microsite, not this notification system.",
    provider: "gmail"
  }
};

const FIXTURE_PROJECTS: Record<ProjectFixtureKey, { name: string; slug: string }> = {
  project_alpha: { name: "Project Alpha", slug: "project-alpha" },
  project_beta: { name: "Project Beta", slug: "project-beta" },
  project_gamma: { name: "Project Gamma", slug: "project-gamma" },
  project_notion_teams: { name: "Project Notion Teams", slug: "project-notion-teams" },
  project_client_safe: { name: "Project Client Safe", slug: "project-client-safe" }
};

function lexicalMatch(text: string, parts: string[]) {
  const normalized = text.toLowerCase();
  return parts.some((part) => normalized.includes(part.toLowerCase()));
}

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function noOpJobs() {
  return {
    enqueue: async () => undefined
  };
}

function noOpTelemetry() {
  return {
    increment: () => undefined,
    observeDuration: () => undefined,
    setGauge: () => undefined,
    renderPrometheus: () => ""
  };
}

function makeEnv() {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    APP_BASE_URL: "http://localhost:3000",
    CORS_ALLOWED_ORIGINS: "http://localhost:3001",
    DATABASE_URL: "postgresql://eval",
    DIRECT_URL: "postgresql://eval",
    REDIS_URL: "redis://localhost:6379",
    QUEUE_MODE: "inline",
    QUEUE_PREFIX: "orchestra",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_ROOT: "./storage",
    SIGNED_URL_TTL_SECONDS: 3600,
    JWT_ACCESS_SECRET: "test-access-secret",
    JWT_REFRESH_SECRET: "test-refresh-secret",
    JWT_ACCESS_TTL: "15m",
    JWT_REFRESH_TTL: "30d",
    PASSWORD_HASH_COST: 12,
    OPENAI_EMBEDDING_MODEL: "mock",
    ANTHROPIC_MODEL_REASONING: "mock",
    OPENAI_TRANSCRIPTION_MODEL: "mock-transcribe",
    RETRIEVAL_TOP_K: 8,
    RETRIEVAL_MIN_SCORE: 0,
    RETRIEVAL_USE_HYBRID: true,
    RETRIEVAL_DOC_WEIGHT: 1,
    RETRIEVAL_COMM_WEIGHT: 0.8,
    RETRIEVAL_ACCEPTED_TRUTH_BOOST: 1.2,
    RERANK_PROVIDER: "none",
    COHERE_API_KEY: undefined,
    COHERE_RERANK_MODEL: "rerank-v3.5",
    RERANK_MAX_CANDIDATES: 32,
    RERANK_TOP_K: 8,
    RERANK_MIN_SCORE: 0,
    LLM_RERANK_MAX_CANDIDATES: 12,
    LLM_RERANK_ENABLED_FOR_INTENTS: "no_evidence_or_ambiguous,comparison_or_diff,explain_for_role",
    RERANK_FAIL_OPEN_TO_DETERMINISTIC: true,
    SOCRATES_MAX_CONTEXT_TOKENS: 12000,
    SOCRATES_MAX_HISTORY_TURNS: 8,
    SOCRATES_RETRIEVAL_TOP_K: 32,
    SOCRATES_RERANK_TOP_K: 8,
    SOCRATES_RETRIEVAL_TIMEOUT_MS: 1000,
    SOCRATES_GENERATION_TIMEOUT_MS: 1000,
    SOCRATES_MAX_RETRIEVAL_CANDIDATES: 64,
    SOCRATES_MAX_EVIDENCE_ITEMS: 10,
    SOCRATES_MAX_EVIDENCE_EXCERPT_CHARS: 900,
    SOCRATES_MAX_SAME_SOURCE_ITEMS: 2,
    SOCRATES_DASHBOARD_EVIDENCE_LIMIT: 5,
    SOCRATES_CURRENT_TRUTH_EVIDENCE_LIMIT: 8,
    SOCRATES_PROVENANCE_EVIDENCE_LIMIT: 10,
    SOCRATES_HISTORY_EVIDENCE_LIMIT: 12,
    SOCRATES_DIFF_EVIDENCE_LIMIT: 12,
    SOCRATES_MAX_CITATIONS: 6,
    SOCRATES_MAX_OPEN_TARGETS: 6,
    SOCRATES_MAX_ANSWER_CHARS: 4000,
    SOCRATES_MAX_OUTPUT_TOKENS: 1800,
    MVP_MODE: true,
    MVP_EQUAL_PROJECT_ACCESS: true,
    MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams"],
    MVP_ENABLE_ADVANCED_CONNECTORS: false,
    MVP_ENABLE_PROJECT_FINANCE: false,
    MVP_ENABLE_PROJECT_SUBSCRIPTIONS: false,
    MVP_ENABLE_CALENDAR_SYNC: false,
    MVP_ENABLE_CALENDLY: false,
    METRICS_TOKEN: undefined
  } as const;
}

function seedProject(store: Store, projectFixture: ProjectFixtureKey) {
  const projectId = fixtureUuid("project", projectFixture);
  store.projects.set(projectId, {
    id: projectId,
    orgId: fixtureUuid("org", "default"),
    name: FIXTURE_PROJECTS[projectFixture].name,
    slug: FIXTURE_PROJECTS[projectFixture].slug,
    status: "active",
    createdAt: new Date("2026-04-01T00:00:00.000Z")
  });

  const roles: Array<"manager" | "dev" | "client"> = projectFixture === "project_client_safe" ? ["manager", "dev", "client"] : ["manager", "dev"];
  for (const role of roles) {
    const userId = fixtureUuid("user", role);
    store.projectMembers.set(`${projectId}:${userId}`, {
      id: fixtureUuid("membership", `${projectFixture}:${role}`),
      projectId,
      userId,
      projectRole: role,
      isActive: true,
      allocationPercent: role === "manager" ? 100 : 85,
      weeklyCapacityHours: 40,
      user: {
        id: userId,
        displayName: role,
        workspaceRoleDefault: role,
        isActive: true
      }
    });
  }

  const connectorId = fixtureUuid("connector", `${projectFixture}:manual_import`);
  store.communicationConnectors.set(connectorId, {
    id: connectorId,
    projectId,
    provider: "manual_import",
    status: "connected",
    accountLabel: "Manual import",
    lastSyncedAt: new Date("2026-04-20T12:00:00.000Z"),
    lastError: null
  });

  const dashboardScope = projectFixture === "project_client_safe" ? "project" : "project";
  const dashboardSnapshotId = fixtureUuid("dashboard", projectFixture);
  store.dashboardSnapshots.set(dashboardSnapshotId, {
    id: dashboardSnapshotId,
    orgId: fixtureUuid("org", "default"),
    projectId,
    scope: dashboardScope,
    computedAt: new Date("2026-04-20T12:10:00.000Z"),
    payloadJson: {
      summary: `${FIXTURE_PROJECTS[projectFixture].name} snapshot`,
      attention: projectFixture === "project_gamma" ? "attention" : "healthy",
      mvpCommunication: {
        enabledProviders: ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams"],
        disabledDirectProviders: ["gmail", "outlook", "whatsapp_business"],
        note: "MVP communication uses manual import, Fireflies, Slack, ClickUp, Granola, and Microsoft Teams; WhatsApp text exports are manual context."
      }
    }
  });

  if (projectFixture === "project_alpha") {
    seedAlpha(store, projectId, connectorId);
  } else if (projectFixture === "project_beta") {
    seedBeta(store, projectId, connectorId);
  } else if (projectFixture === "project_gamma") {
    seedGamma(store, projectId, connectorId);
  } else if (projectFixture === "project_notion_teams") {
    seedNotionTeams(store, projectId, connectorId);
  } else {
    seedClientSafe(store, projectId, connectorId);
  }
}

function createDocument(store: Store, projectId: string, key: string, input: { title: string; visibility: "internal" | "shared_with_client"; sections: Array<{ anchorId: string; text: string; pageNumber: number }> }) {
  const documentId = fixtureUuid("document", `${projectId}:${key}`);
  const versionId = fixtureUuid("document_version", `${projectId}:${key}:v1`);
  store.documents.set(documentId, {
    id: documentId,
    projectId,
    title: input.title,
    kind: "prd",
    visibility: input.visibility,
    currentVersionId: versionId
  });
  store.documentVersions.set(versionId, {
    id: versionId,
    projectId,
    documentId,
    versionNumber: 1,
    status: "ready",
    parseRevision: 1,
    createdAt: new Date("2026-04-10T00:00:00.000Z")
  });
  input.sections.forEach((section, index) => {
    const sectionId = fixtureUuid("document_section", `${projectId}:${key}:${section.anchorId}`);
    store.documentSections.set(sectionId, {
      id: sectionId,
      projectId,
      documentVersionId: versionId,
      parseRevision: 1,
      orderIndex: index + 1,
      anchorId: section.anchorId,
      anchorText: section.anchorId,
      pageNumber: section.pageNumber,
      headingPath: [input.title, section.anchorId],
      normalizedText: section.text,
      createdAt: new Date("2026-04-10T00:00:00.000Z")
    });
    const chunkId = fixtureUuid("document_chunk", `${sectionId}:0`);
    store.documentChunks.set(chunkId, {
      id: chunkId,
      projectId,
      documentVersionId: versionId,
      parseRevision: 1,
      sectionId,
      content: section.text,
      contextualContent: `${input.title} ${section.anchorId} ${section.text}`,
      lexicalContent: `${input.title} ${section.anchorId} ${section.text}`,
      pageNumber: section.pageNumber
    });
  });
  return { documentId, versionId };
}

function createNotionDocument(
  store: Store,
  projectId: string,
  key: string,
  input: {
    title: string;
    selectedResourceLabel: string;
    providerUrl?: string;
    sections: Array<{ anchorId: string; text: string; pageNumber: number }>;
  }
) {
  const { documentId, versionId } = createDocument(store, projectId, key, {
    title: input.title,
    visibility: "internal",
    sections: input.sections
  });
  const resourceId = fixtureUuid("notion_resource", `${projectId}:${key}`);
  const now = new Date("2026-05-14T08:45:00.000Z");
  store.projectNotionResources.set(resourceId, {
    id: resourceId,
    projectId,
    orgId: fixtureUuid("org", "alpha"),
    connectionId: fixtureUuid("notion_connection", `${projectId}:selected`),
    providerResourceId: `notion:${key}`,
    parentProviderResourceId: null,
    resourceType: "page",
    title: input.title,
    url: input.providerUrl ?? `https://notion.example/${key}`,
    selected: true,
    selectedResourceLabel: input.selectedResourceLabel,
    indexStatus: "ready",
    documentId,
    documentVersionId: versionId,
    lastEditedAt: now,
    lastIndexedAt: now,
    createdAt: now,
    updatedAt: now
  });
  return { documentId, versionId, resourceId };
}

function createArtifacts(store: Store, projectId: string, key: string, payload: { productBrain: string; nodes: Array<{ nodeKey: string; title: string; summary: string; sectionAnchor: string }> }) {
  const brainId = fixtureUuid("artifact", `${projectId}:${key}:product_brain`);
  const graphId = fixtureUuid("artifact", `${projectId}:${key}:brain_graph`);
  store.artifactVersions.set(brainId, {
    id: brainId,
    projectId,
    artifactType: "product_brain",
    status: "accepted",
    versionNumber: 2,
    acceptedAt: new Date("2026-04-20T10:00:00.000Z"),
    payloadJson: {
      whatTheProductIs: payload.productBrain,
      mainFlows: [payload.productBrain],
      modules: payload.nodes.map((node) => node.title),
      constraints: [],
      unresolvedAreas: []
    }
  });
  store.artifactVersions.set(graphId, {
    id: graphId,
    projectId,
    artifactType: "brain_graph",
    status: "accepted",
    versionNumber: 2,
    acceptedAt: new Date("2026-04-20T10:00:00.000Z"),
    payloadJson: {}
  });

  payload.nodes.forEach((node) => {
    const nodeId = fixtureUuid("brain_node", `${projectId}:${node.nodeKey}`);
    store.brainNodes.set(nodeId, {
      id: nodeId,
      projectId,
      artifactVersionId: graphId,
      nodeKey: node.nodeKey,
      title: node.title,
      summary: node.summary,
      bodyText: node.summary,
      createdAt: new Date("2026-04-20T10:00:00.000Z")
    });
    const sectionId = fixtureUuid("document_section", `${projectId}:${key}:${node.sectionAnchor}`);
    const linkId = fixtureUuid("brain_link", `${nodeId}:${sectionId}`);
    store.brainSectionLinks.set(linkId, {
      id: linkId,
      projectId,
      artifactVersionId: graphId,
      brainNodeId: nodeId,
      documentSectionId: sectionId
    });
  });

  return { brainId, graphId };
}

function createThreadWithMessage(store: Store, projectId: string, connectorId: string, key: string, input: FixtureMessageDefinition) {
  const threadId = fixtureUuid("thread", `${projectId}:${input.provider ?? "manual_import"}:${input.threadSubject}`);
  if (!store.communicationThreads.has(threadId)) {
    store.communicationThreads.set(threadId, {
      id: threadId,
      projectId,
      connectorId,
      provider: input.provider ?? "manual_import",
      providerThreadId: `${input.provider ?? "manual_import"}:${input.threadSubject}`,
      subject: input.threadSubject,
      participantsJson: [{ label: input.senderLabel, email: input.senderEmail ?? null }]
    });
  }
  const messageId = fixtureUuid("message", `${projectId}:${key}:${input.sentAt}`);
  const bodyHash = createHash("sha256").update(input.bodyText).digest("hex");
  store.communicationMessages.set(messageId, {
    id: messageId,
    projectId,
    connectorId,
    provider: input.provider ?? "manual_import",
    threadId,
    providerMessageId: `${key}:${input.sentAt}`,
    senderLabel: input.senderLabel,
    senderEmail: input.senderEmail ?? null,
    sentAt: new Date(input.sentAt),
    bodyText: input.bodyText,
    bodyHtml: null,
    bodyHash,
    isDeletedByProvider: false,
    isEdited: false,
    messageType: input.messageType ?? "user",
    rawMetadataJson: {}
  });
  return { threadId, messageId };
}

function createAcceptedProposal(store: Store, projectId: string, key: string, input: { title: string; summary: string; sectionAnchor: string; nodeKey: string; messageKey: string }) {
  const proposalId = fixtureUuid("proposal", `${projectId}:${key}`);
  const messageId = fixtureUuid("message", `${projectId}:${input.messageKey}:2026-04-20T10:00:00.000Z`);
  const threadId = fixtureUuid("thread", `${projectId}:${input.messageKey}:${input.title}`);
  const sectionId = fixtureUuid("document_section", `${projectId}:${key}:${input.sectionAnchor}`);
  const nodeId = fixtureUuid("brain_node", `${projectId}:${input.nodeKey}`);
  store.specChangeProposals.set(proposalId, {
    id: proposalId,
    projectId,
    title: input.title,
    summary: input.summary,
    proposalType: "requirement_change",
    status: "accepted",
    sourceMessageCount: 1,
    acceptedAt: new Date("2026-04-20T10:05:00.000Z"),
    acceptedBrainVersionId: fixtureUuid("artifact", `${projectId}:${key}:product_brain`)
  });
  const links = [
    { linkType: "message", linkRefId: messageId, relationship: "source" },
    { linkType: "thread", linkRefId: threadId, relationship: "evidence" },
    { linkType: "document_section", linkRefId: sectionId, relationship: "affected" },
    { linkType: "brain_node", linkRefId: nodeId, relationship: "affected" }
  ];
  links.forEach((link, index) => {
    store.specChangeLinks.set(fixtureUuid("proposal_link", `${proposalId}:${index}`), {
      id: fixtureUuid("proposal_link", `${proposalId}:${index}`),
      specChangeProposalId: proposalId,
      projectId,
      ...link
    });
  });
}

function createCodingRequirementsArtifact(store: Store, projectId: string, key: string) {
  const artifactId = fixtureUuid("artifact", `${projectId}:${key}:engineering_requirements`);
  const diagramId = fixtureUuid("project_diagram", `${projectId}:${key}:main_coding_flowchart`);
  const codingRequirementsId = fixtureUuid("coding_requirements", `${projectId}:${key}:current`);
  const now = new Date("2026-04-20T10:10:00.000Z");
  const mermaid = [
    "flowchart TD",
    "  A[Product Brain] --> B[Assignment Approval Module]",
    "  B --> C[Weekly Reporting Module]",
    "  C --> D[Release Validation]"
  ].join("\n");
  store.artifactVersions.set(artifactId, {
    id: artifactId,
    projectId,
    artifactType: "engineering_requirements",
    status: "accepted",
    versionNumber: 1,
    acceptedAt: now,
    payloadJson: {
      summary: "Build manager assignment approval first, then weekly reporting and release validation.",
      modules: [
        {
          name: "Assignment Approval Module",
          purpose: "Require manager approval before assignment activation.",
          requirements: ["Capture approval state before activating an assignment."],
          apis: ["POST /assignments/:id/approve"],
          dataModels: ["AssignmentApproval"],
          dependencies: ["Product Brain accepted assignment requirement"],
          risks: ["Approval bypass must be prevented."],
          suggestedBuildOrder: 1,
          assumptions: [],
          unknowns: [],
          citations: [{ type: "product_brain", refId: fixtureUuid("artifact", `${projectId}:${key}:product_brain`), label: "Product Brain" }],
          openTargets: []
        },
        {
          name: "Weekly Reporting Module",
          purpose: "Provide weekly manager reporting.",
          requirements: ["Generate manager-facing weekly reports."],
          apis: ["GET /reports/weekly"],
          dataModels: ["WeeklyReport"],
          dependencies: ["Assignment Approval Module"],
          risks: ["Reporting cadence must not fall back to monthly summaries."],
          suggestedBuildOrder: 2,
          assumptions: [],
          unknowns: ["Exact report delivery channel is not specified."],
          citations: [{ type: "product_brain", refId: fixtureUuid("artifact", `${projectId}:${key}:product_brain`), label: "Product Brain" }],
          openTargets: []
        }
      ],
      globalRequirements: ["Use current accepted Product Brain truth as the primary source."],
      integrationPoints: ["Assignment approval feeds weekly reporting."],
      assumptions: [],
      unknowns: ["Exact report delivery channel is not specified."],
      suggestedBuildOrder: [
        { order: 1, moduleName: "Assignment Approval Module", reason: "It gates activation behavior.", dependencies: [] },
        { order: 2, moduleName: "Weekly Reporting Module", reason: "It depends on accepted assignment and manager state.", dependencies: ["Assignment Approval Module"] }
      ],
      mermaid,
      citations: [{ type: "product_brain", refId: fixtureUuid("artifact", `${projectId}:${key}:product_brain`), label: "Product Brain" }],
      openTargets: [],
      generatedAt: now.toISOString(),
      evidenceSummary: {
        sourceCounts: { product_brain: 1, brain_node: 2, document_chunk: 3 },
        lowEvidence: false,
        limitations: []
      }
    }
  });
  store.projectDiagrams.set(diagramId, {
    id: diagramId,
    projectId,
    title: "Main Coding Flowchart",
    description: "Derived coding flowchart for Project Alpha engineering requirements.",
    diagramType: "coding_flow",
    mermaidSource: mermaid,
    source: "socrates_generated",
    status: "active",
    linkedArtifactVersionId: artifactId,
    linkedDocumentSectionIdsJson: [],
    linkedBrainNodeIdsJson: [],
    linkedContextEntryIdsJson: [],
    createdAt: now,
    updatedAt: now,
    liveDocEmbeds: []
  });
  store.projectCodingRequirements.set(codingRequirementsId, {
    id: codingRequirementsId,
    projectId,
    artifactVersionId: artifactId,
    mermaidDiagramId: diagramId,
    generatedByUserId: fixtureUuid("user", "manager"),
    createdAt: now,
    updatedAt: now
  });
}

function createContextEntry(
  store: Store,
  projectId: string,
  key: string,
  input: {
    type: string;
    title: string;
    rawText: string;
    contextualText?: string;
    importance?: "normal" | "high";
    status?: "active" | "deleted";
    attachment?: {
      attachmentKind: string;
      mimeType: string;
      originalFilename: string;
      caption: string;
      description: string;
    };
  }
) {
  const entryId = fixtureUuid("project_context", `${projectId}:${key}`);
  const chunkId = fixtureUuid("project_context_chunk", `${projectId}:${key}:chunk`);
  const now = new Date("2026-04-20T10:08:00.000Z");
  store.projectContextEntries.set(entryId, {
    id: entryId,
    projectId,
    type: input.type,
    title: input.title,
    status: input.status ?? "active",
    participantsJson: [],
    tagsJson: [],
    sourceDate: now,
    linkedMemberId: null,
    importance: input.importance ?? "normal",
    createdAt: now,
    updatedAt: now
  });
  store.projectContextChunks.set(chunkId, {
    id: chunkId,
    projectId,
    contextEntryId: entryId,
    rawText: input.rawText,
    contextualText: input.contextualText ?? `${input.title}\n${input.rawText}`,
    lexicalText: `${input.title} ${input.rawText}`,
    embedding: [0.1, 0.2, 0.3],
    createdAt: now,
    updatedAt: now
  });
  if (input.attachment) {
    const attachmentId = fixtureUuid("project_context_attachment", `${projectId}:${key}:attachment`);
    store.projectContextAttachments.set(attachmentId, {
      id: attachmentId,
      projectId,
      contextEntryId: entryId,
      attachmentKind: input.attachment.attachmentKind,
      mimeType: input.attachment.mimeType,
      originalFilename: input.attachment.originalFilename,
      filename: input.attachment.originalFilename,
      caption: input.attachment.caption,
      description: input.attachment.description,
      createdAt: now
    });
  }
}

function createResponsibility(
  store: Store,
  projectId: string,
  key: string,
  input: {
    memberRole?: "manager" | "dev";
    assigneeName?: string;
    title: string;
    description: string;
    area: string;
    status: string;
  }
) {
  const memberId = input.memberRole ? fixtureUuid("membership", `project_alpha:${input.memberRole}`) : null;
  const id = fixtureUuid("project_responsibility", `${projectId}:${key}`);
  store.projectResponsibilities.set(id, {
    id,
    projectId,
    memberId,
    assigneeName: input.assigneeName ?? null,
    title: input.title,
    description: input.description,
    area: input.area,
    status: input.status,
    createdAt: new Date("2026-04-20T10:09:00.000Z"),
    updatedAt: new Date("2026-04-20T10:09:00.000Z")
  });
}

function seedAlpha(store: Store, projectId: string, connectorId: string) {
  createDocument(store, projectId, "project_alpha", {
    title: "Alpha PRD",
    visibility: "internal",
    sections: [
      { anchorId: "assignment-flow", text: "Original PRD: direct assignment without approval is allowed for managers.", pageNumber: 1 },
      { anchorId: "reporting-scope", text: "Original PRD: managers receive monthly summary reports.", pageNumber: 2 },
      { anchorId: "voice-notes", text: "Original PRD: voice note input is not part of the first release.", pageNumber: 3 }
    ]
  });
  createArtifacts(store, projectId, "project_alpha", {
    productBrain: "Current truth: manager approval is required before assignment activation, and managers receive weekly reporting.",
    nodes: [
      { nodeKey: "assignment-approval", title: "Assignment Approval", summary: "Current truth requires manager approval before assignment activation.", sectionAnchor: "assignment-flow" },
      { nodeKey: "weekly-reporting", title: "Weekly Reporting", summary: "Managers receive weekly reports in the accepted current truth.", sectionAnchor: "reporting-scope" }
    ]
  });
  createCodingRequirementsArtifact(store, projectId, "project_alpha");
  createThreadWithMessage(store, projectId, connectorId, "alpha_assignment_source", {
    threadSubject: "Manager approval change",
    senderLabel: "Client PM",
    senderEmail: "client@example.com",
    sentAt: "2026-04-20T10:00:00.000Z",
    bodyText: "Let’s require manager approval before any assignment activation.",
    provider: "slack"
  });
  createThreadWithMessage(store, projectId, connectorId, "alpha_reporting_source", {
    threadSubject: "Weekly reporting change",
    senderLabel: "Client PM",
    senderEmail: "client@example.com",
    sentAt: "2026-04-20T10:00:00.000Z",
    bodyText: "Please switch manager reporting from monthly to weekly.",
    provider: "gmail"
  });
  createAcceptedProposal(store, projectId, "project_alpha", {
    title: "Manager approval required",
    summary: "Accepted change: assignments now require manager approval.",
    sectionAnchor: "assignment-flow",
    nodeKey: "assignment-approval",
    messageKey: "alpha_assignment_source"
  });
  const decisionId = fixtureUuid("decision", `${projectId}:weekly-reporting`);
  store.decisionRecords.set(decisionId, {
    id: decisionId,
    projectId,
    title: "Weekly reporting approved",
    statement: "Managers receive weekly reports rather than monthly summaries.",
    status: "accepted",
    acceptedAt: new Date("2026-04-20T10:06:00.000Z")
  });
}

function seedNotionTeams(store: Store, projectId: string, connectorId: string) {
  createDocument(store, projectId, "project_notion_teams", {
    title: "Notion Teams PRD",
    visibility: "internal",
    sections: [
      {
        anchorId: "source-governance",
        text:
          "Product requirement: Notion and Microsoft Teams are native read-only evidence sources. Selected Notion pages and selected Teams threads can inform Socrates, PM Watchtower, Dashboard, and Timeline.",
        pageNumber: 1
      },
      {
        anchorId: "truth-gate",
        text:
          "Product requirement: LiveDoc review remains the truth gate. Notion pages and Teams messages are evidence only until a manager or approved truth approver accepts a review item.",
        pageNumber: 2
      }
    ]
  });
  createNotionDocument(store, projectId, "notion_teams_launch_plan", {
    title: "Notion Launch Plan",
    selectedResourceLabel: "Launch workspace",
    sections: [
      {
        anchorId: "launch-review-checklist",
        text:
          "Selected Notion launch checklist: keep QA owner and rollback steps visible before launch review. Teams approval is evidence only until a manager accepts the LiveDoc review item.",
        pageNumber: 1
      },
      {
        anchorId: "truth-gate-note",
        text:
          "Notion decision note: selected Notion pages can inform Socrates and Project Memory, but they do not mutate Product Brain without manager approval.",
        pageNumber: 2
      }
    ]
  });
  createArtifacts(store, projectId, "project_notion_teams", {
    productBrain: "Current truth: selected Notion and Teams evidence is read-only and must pass LiveDoc review before becoming accepted product truth.",
    nodes: [
      {
        nodeKey: "source-governance",
        title: "Source Governance",
        summary: "Notion and Teams are native read-only evidence sources.",
        sectionAnchor: "source-governance"
      },
      {
        nodeKey: "truth-gate",
        title: "Truth Gate",
        summary: "LiveDoc review remains the gate before evidence becomes accepted truth.",
        sectionAnchor: "truth-gate"
      }
    ]
  });
}

function seedBeta(store: Store, projectId: string, connectorId: string) {
  createDocument(store, projectId, "project_beta", {
    title: "Beta PRD",
    visibility: "internal",
    sections: [
      { anchorId: "notification-flow", text: "Original PRD: send individual notification emails immediately.", pageNumber: 1 },
      { anchorId: "reporting-summary", text: "Original PRD: reporting uses a daily digest.", pageNumber: 2 }
    ]
  });
  createArtifacts(store, projectId, "project_beta", {
    productBrain: "Current truth: launch notifications ship as Friday digest emails.",
    nodes: [
      { nodeKey: "digest-notifications", title: "Digest Notifications", summary: "Friday digest emails are the accepted launch notification flow.", sectionAnchor: "notification-flow" }
    ]
  });
  createThreadWithMessage(store, projectId, connectorId, "beta_digest_source", {
    threadSubject: "Digest emails",
    senderLabel: "Founder",
    senderEmail: "founder@example.com",
    sentAt: "2026-04-20T10:00:00.000Z",
    bodyText: "We decided to ship Friday digest emails instead of immediate notifications.",
    provider: "gmail"
  });
  const decisionId = fixtureUuid("decision", `${projectId}:digest-emails`);
  store.decisionRecords.set(decisionId, {
    id: decisionId,
    projectId,
    title: "Friday digest emails",
    statement: "Use Friday digest emails for launch notifications.",
    status: "accepted",
    acceptedAt: new Date("2026-04-20T10:05:00.000Z")
  });
}

function seedGamma(store: Store, projectId: string, connectorId: string) {
  createDocument(store, projectId, "project_gamma", {
    title: "Gamma PRD",
    visibility: "internal",
    sections: [
      { anchorId: "launch-alerts", text: "Original PRD: launch alerts are delivered by email.", pageNumber: 1 },
      { anchorId: "sso-gate", text: "Original PRD: launch stays behind the SSO gate until approval is complete.", pageNumber: 2 }
    ]
  });
  createArtifacts(store, projectId, "project_gamma", {
    productBrain: "Current truth: launch remains gated behind SSO and email alerts remain the accepted default.",
    nodes: [
      { nodeKey: "launch-alerts", title: "Launch Alerts", summary: "Email alerts remain accepted until a manager-approved change says otherwise.", sectionAnchor: "launch-alerts" },
      { nodeKey: "sso-gate", title: "SSO Gate", summary: "Launch remains blocked behind the SSO gate.", sectionAnchor: "sso-gate" }
    ]
  });
  createThreadWithMessage(store, projectId, connectorId, "gamma_blocker_source", {
    threadSubject: "SSO blocker",
    senderLabel: "Engineering Lead",
    sentAt: "2026-04-20T10:00:00.000Z",
    bodyText: "We are blocked until the SSO approval flow is fixed.",
    provider: "slack"
  });
  const pendingProposalId = fixtureUuid("proposal", `${projectId}:pending-sms-alerts`);
  store.specChangeProposals.set(pendingProposalId, {
    id: pendingProposalId,
    projectId,
    title: "Switch launch alerts to SMS",
    summary: "Needs review: use SMS alerts for launch.",
    proposalType: "requirement_change",
    status: "needs_review",
    sourceMessageCount: 1,
    acceptedBrainVersionId: null
  });
}

function seedClientSafe(store: Store, projectId: string, connectorId: string) {
  createDocument(store, projectId, "project_client_safe_shared", {
    title: "Client Shared Scope",
    visibility: "shared_with_client",
    sections: [
      { anchorId: "shared-summary", text: "Shared scope: weekly summary reporting is included for clients.", pageNumber: 1 }
    ]
  });
  createDocument(store, projectId, "project_client_safe_internal", {
    title: "Internal Escalation Rules",
    visibility: "internal",
    sections: [
      { anchorId: "slack-war-room", text: "Internal rule: trigger a Slack war room for P1 escalations.", pageNumber: 1 }
    ]
  });
  createArtifacts(store, projectId, "project_client_safe_shared", {
    productBrain: "Client-safe current truth: weekly summary reporting is part of shared scope.",
    nodes: [
      { nodeKey: "shared-weekly-summary", title: "Shared Weekly Summary", summary: "Weekly summary reporting is client-visible current truth.", sectionAnchor: "shared-summary" }
    ]
  });
  const internalGraphId = fixtureUuid("artifact", `${projectId}:internal-graph`);
  store.artifactVersions.set(internalGraphId, {
    id: internalGraphId,
    projectId,
    artifactType: "brain_graph",
    status: "accepted",
    versionNumber: 3,
    acceptedAt: new Date("2026-04-20T10:00:00.000Z"),
    payloadJson: {}
  });
  const internalNodeId = fixtureUuid("brain_node", `${projectId}:internal-escalation`);
  store.brainNodes.set(internalNodeId, {
    id: internalNodeId,
    projectId,
    artifactVersionId: internalGraphId,
    nodeKey: "internal-escalation",
    title: "Internal Escalation",
    summary: "Slack war room escalation is internal-only.",
    bodyText: "Slack war room escalation is internal-only.",
    createdAt: new Date("2026-04-20T10:00:00.000Z")
  });
  const internalSectionId = fixtureUuid("document_section", `${projectId}:project_client_safe_internal:slack-war-room`);
  store.brainSectionLinks.set(fixtureUuid("brain_link", `${internalNodeId}:${internalSectionId}`), {
    id: fixtureUuid("brain_link", `${internalNodeId}:${internalSectionId}`),
    projectId,
    artifactVersionId: internalGraphId,
    brainNodeId: internalNodeId,
    documentSectionId: internalSectionId
  });
  createThreadWithMessage(store, projectId, connectorId, "client_safe_internal_message", {
    threadSubject: "Internal escalation",
    senderLabel: "Support Lead",
    sentAt: "2026-04-20T10:00:00.000Z",
    bodyText: "Use the Slack war room when a P1 incident is declared.",
    provider: "slack"
  });
  createThreadWithMessage(store, projectId, connectorId, "client_safe_fireflies_transcript", {
    threadSubject: "Private client meeting transcript",
    senderLabel: "Fireflies.ai transcript",
    sentAt: "2026-04-20T11:00:00.000Z",
    bodyText:
      "[00:02:14] Sarah Client: This Fireflies transcript includes private speaker names, transcript id ff-client-private, and provider URL https://app.fireflies.ai/view/ff-client-private.",
    provider: "fireflies_ai"
  });
}

function buildPrisma(store: Store) {
  const prisma: any = {};

  prisma.$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);
  prisma.$executeRawUnsafe = async () => 1;
  prisma.$queryRawUnsafe = async (sql: string, projectId: string, _vectorLiteral: string, limit: number) => {
    if (sql.includes("FROM document_chunks")) {
      const visibilityFilterSharedOnly = sql.includes("shared_with_client");
      const rows = Array.from(store.documentChunks.values())
        .filter((chunk: any) => chunk.projectId === projectId)
        .map((chunk: any) => {
          const version = store.documentVersions.get(chunk.documentVersionId);
          const document = store.documents.get(version.documentId);
          const section = chunk.sectionId ? store.documentSections.get(chunk.sectionId) : null;
          if (!version || !document || version.status !== "ready" || chunk.parseRevision !== version.parseRevision) {
            return null;
          }
          if (visibilityFilterSharedOnly && document.visibility !== "shared_with_client") {
            return null;
          }
          const notionResource = Array.from(store.projectNotionResources.values()).find(
            (resource: any) =>
              resource.projectId === projectId &&
              resource.documentVersionId === chunk.documentVersionId &&
              resource.selected &&
              !["inaccessible", "unsupported", "unselected", "provider_error"].includes(resource.indexStatus)
          );
          return {
            id: chunk.id,
            section_id: chunk.sectionId,
            content: chunk.content,
            contextual_content: chunk.contextualContent,
            lexical_content: chunk.lexicalContent,
            page_number: chunk.pageNumber,
            document_version_id: chunk.documentVersionId,
            metadata_json: notionResource
              ? {
                  sourceProvider: "notion",
                  notionResourceId: notionResource.id,
                  selectedResourceLabel: notionResource.selectedResourceLabel
                }
              : {},
            visibility: document.visibility,
            doc_title: notionResource ? `Notion · ${document.title}` : document.title,
            anchor_id: section?.anchorId ?? null,
            vec_dist: 0.12
          };
        })
        .filter((row: unknown): row is Record<string, unknown> => Boolean(row))
        .slice(0, limit);
      return rows;
    }
    if (sql.includes("FROM communication_message_chunks")) {
      return Array.from(store.communicationMessageChunks.values())
        .filter((chunk: any) => chunk.projectId === projectId)
        .map((chunk: any) => {
          const message = store.communicationMessages.get(chunk.messageId);
          const thread = store.communicationThreads.get(chunk.threadId);
          if (!message || !thread || message.isDeletedByProvider) {
            return null;
          }
          return {
            message_id: chunk.messageId,
            thread_id: chunk.threadId,
            content: chunk.content,
            contextual_content: chunk.contextualContent,
            lexical_content: chunk.lexicalContent,
            sender_label: message.senderLabel,
            subject: thread.subject,
            vec_dist: 0.1
          };
        })
        .filter((row: unknown): row is Record<string, unknown> => Boolean(row))
        .slice(0, limit);
    }
    return [];
  };

  prisma.auditEvent = {
    create: async ({ data }: { data: any }) => {
      const row = { id: fixtureUuid("audit", `${store.auditEvents.length}`), ...data };
      store.auditEvents.push(row);
      return row;
    }
  };

  prisma.project = {
    findUniqueOrThrow: async ({ where, select }: any) => {
      const project = store.projects.get(where.id);
      if (!project) throw new Error("Project not found");
      if (!select) return project;
      return Object.fromEntries(Object.keys(select).map((key) => [key, project[key]]));
    },
    findUnique: async ({ where, select }: any) => {
      const project = store.projects.get(where.id);
      if (!project) return null;
      if (!select) return project;
      return Object.fromEntries(Object.keys(select).map((key) => [key, project[key]]));
    }
  };

  prisma.projectMember = {
    findFirst: async ({ where }: any) =>
      Array.from(store.projectMembers.values()).find(
        (member: any) =>
          (!where.projectId || member.projectId === where.projectId) &&
          (!where.userId || member.userId === where.userId) &&
          (where.isActive === undefined || member.isActive === where.isActive)
      ) ?? null
  };

  prisma.document = {
    findFirst: async ({ where }: any) =>
      Array.from(store.documents.values()).find(
        (document: any) =>
          (!where.id || document.id === where.id) &&
          (!where.projectId || document.projectId === where.projectId)
      ) ?? null
  };

  prisma.documentVersion = {
    findFirst: async ({ where, include }: any) => {
      const version = Array.from(store.documentVersions.values()).find(
        (item: any) =>
          (!where.id || item.id === where.id) &&
          (!where.projectId || item.projectId === where.projectId) &&
          (!where.documentId || item.documentId === where.documentId) &&
          (!where.status?.in || where.status.in.includes(item.status))
      );
      if (!version) return null;
      if (!include?.document) return version;
      return { ...version, document: store.documents.get(version.documentId) };
    }
  };

  prisma.documentSection = {
    findFirst: async ({ where, include, select }: any) => {
      const section = Array.from(store.documentSections.values()).find((item: any) => {
        if (where.id && item.id !== where.id) return false;
        if (where.projectId && item.projectId !== where.projectId) return false;
        if (where.documentVersionId && item.documentVersionId !== where.documentVersionId) return false;
        if (where.anchorId && item.anchorId !== where.anchorId) return false;
        return true;
      });
      if (!section) return null;
      if (select) {
        return Object.fromEntries(Object.keys(select).map((key) => [key, section[key]]));
      }
      if (!include?.documentVersion) return section;
      const version = store.documentVersions.get(section.documentVersionId);
      const document = version ? store.documents.get(version.documentId) : null;
      return { ...section, documentVersion: { ...version, document } };
    },
    findMany: async ({ where, include, orderBy, select, skip, take }: any) => {
      let rows = Array.from(store.documentSections.values()).filter((item: any) => {
        if (where.projectId && item.projectId !== where.projectId) return false;
        if (where.documentVersionId && item.documentVersionId !== where.documentVersionId) return false;
        if (where.parseRevision !== undefined && item.parseRevision !== where.parseRevision) return false;
        if (where.id?.in && !where.id.in.includes(item.id)) return false;
        if (where.id?.not && item.id === where.id.not) return false;
        if (where.anchorId && item.anchorId !== where.anchorId) return false;
        if (where.orderIndex?.gte !== undefined && item.orderIndex < where.orderIndex.gte) return false;
        if (where.orderIndex?.lte !== undefined && item.orderIndex > where.orderIndex.lte) return false;
        if (where.OR && Array.isArray(where.OR) && where.OR.length > 0) {
          const ok = where.OR.some((clause: any) => lexicalMatch(item.normalizedText, [clause.normalizedText.contains]));
          if (!ok) return false;
        }
        if (where.documentVersion?.documentId) {
          const version = store.documentVersions.get(item.documentVersionId);
          if (!version || version.documentId !== where.documentVersion.documentId) return false;
        }
        return true;
      });
      rows.sort((left: any, right: any) => left.orderIndex - right.orderIndex);
      if (orderBy?.createdAt === "desc") {
        rows = rows.reverse();
      }
      rows = rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length));
      return rows.map((row: any) => {
        if (select) {
          return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
        }
        if (!include?.documentVersion) return row;
        const version = store.documentVersions.get(row.documentVersionId);
        const document = version ? store.documents.get(version.documentId) : null;
        return { ...row, documentVersion: { ...version, document } };
      });
    },
    count: async ({ where }: any) =>
      Array.from(store.documentSections.values()).filter((item: any) => {
        if (where.projectId && item.projectId !== where.projectId) return false;
        if (where.id?.in && !where.id.in.includes(item.id)) return false;
        return true;
      }).length
  };

  prisma.documentChunk = {
    findFirst: async ({ where, include }: any) => {
      const chunk = Array.from(store.documentChunks.values()).find(
        (item: any) =>
          (!where.id || item.id === where.id || (Array.isArray(where.id?.in) && where.id.in.includes(item.id))) &&
          (!where.projectId || item.projectId === where.projectId)
      );
      if (!chunk) return null;
      if (!include?.documentVersion) return chunk;
      const version = store.documentVersions.get(chunk.documentVersionId);
      const document = version ? store.documents.get(version.documentId) : null;
      return { ...chunk, documentVersion: { ...version, document } };
    }
  };

  prisma.projectNotionResource = {
    findMany: async ({ where }: any) =>
      Array.from(store.projectNotionResources.values()).filter((resource: any) => {
        if (where.projectId && resource.projectId !== where.projectId) return false;
        if (where.documentVersionId?.in && !where.documentVersionId.in.includes(resource.documentVersionId)) return false;
        if (where.indexStatus?.notIn?.includes(resource.indexStatus)) return false;
        return true;
      })
  };

  prisma.brainNode = {
    findFirst: async ({ where }: any) =>
      Array.from(store.brainNodes.values()).find(
        (node: any) => (!where.id || node.id === where.id) && (!where.projectId || node.projectId === where.projectId)
      ) ?? null,
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = Array.from(store.brainNodes.values()).filter((node: any) => {
        if (where.projectId && node.projectId !== where.projectId) return false;
        if (where.id?.in && !where.id.in.includes(node.id)) return false;
        if (where.artifactVersion) {
          const artifact = store.artifactVersions.get(node.artifactVersionId);
          if (!artifact) return false;
          if (where.artifactVersion.artifactType && artifact.artifactType !== where.artifactVersion.artifactType) return false;
          if (where.artifactVersion.status && artifact.status !== where.artifactVersion.status) return false;
        }
        if (where.OR && Array.isArray(where.OR) && where.OR.length > 0) {
          const ok = where.OR.some((clause: any) => {
            if (clause.title) return lexicalMatch(node.title, [clause.title.contains]);
            if (clause.summary) return lexicalMatch(node.summary, [clause.summary.contains]);
            return false;
          });
          if (!ok) return false;
        }
        return true;
      });
      if (orderBy?.createdAt === "desc") {
        rows = rows.reverse();
      }
      return rows.slice(0, take ?? rows.length);
    },
    count: async ({ where }: any) =>
      Array.from(store.brainNodes.values()).filter((node: any) => {
        if (where.projectId && node.projectId !== where.projectId) return false;
        if (where.id?.in && !where.id.in.includes(node.id)) return false;
        return true;
      }).length
  };

  prisma.brainSectionLink = {
    findMany: async ({ where, include, select }: any) => {
      const rows = Array.from(store.brainSectionLinks.values()).filter((link: any) => {
        if (where.projectId && link.projectId !== where.projectId) return false;
        if (where.artifactVersionId && link.artifactVersionId !== where.artifactVersionId) return false;
        if (where.documentSectionId && link.documentSectionId !== where.documentSectionId) return false;
        if (where.brainNodeId && link.brainNodeId !== where.brainNodeId) return false;
        if (where.brainNodeId?.in && !where.brainNodeId.in.includes(link.brainNodeId)) return false;
        return true;
      });
      return rows.map((row: any) => {
        if (select) {
          return { brainNodeId: row.brainNodeId };
        }
        if (!include?.documentSection) return row;
        const section = store.documentSections.get(row.documentSectionId);
        const version = section ? store.documentVersions.get(section.documentVersionId) : null;
        const document = version ? store.documents.get(version.documentId) : null;
        return { ...row, documentSection: { ...section, documentVersion: { ...version, document } } };
      });
    }
  };

  prisma.brainEdge = {
    findMany: async ({ where }: any) =>
      Array.from(store.brainEdges.values()).filter(
        (edge: any) =>
          (!where.artifactVersionId || edge.artifactVersionId === where.artifactVersionId) &&
          (!where.OR || where.OR.some((clause: any) => (clause.fromNodeId && edge.fromNodeId === clause.fromNodeId) || (clause.toNodeId && edge.toNodeId === clause.toNodeId)))
      )
  };

  prisma.artifactVersion = {
    findFirst: async ({ where, orderBy }: any) => {
      let rows = Array.from(store.artifactVersions.values()).filter((artifact: any) => {
        if (where.projectId && artifact.projectId !== where.projectId) return false;
        if (where.id && artifact.id !== where.id) return false;
        if (where.artifactType && artifact.artifactType !== where.artifactType) return false;
        if (where.status && artifact.status !== where.status) return false;
        return true;
      });
      if (orderBy?.versionNumber === "desc") {
        rows.sort((left: any, right: any) => right.versionNumber - left.versionNumber);
      } else if (Array.isArray(orderBy)) {
        rows.sort((left: any, right: any) => (right.acceptedAt?.getTime?.() ?? 0) - (left.acceptedAt?.getTime?.() ?? 0));
      }
      return rows[0] ?? null;
    },
    findUnique: async ({ where }: any) => store.artifactVersions.get(where.id) ?? null
  };

  prisma.projectDiagram = {
    findFirst: async ({ where, include }: any) => {
      const row = Array.from(store.projectDiagrams.values()).find((diagram: any) => {
        if (where.id && diagram.id !== where.id) return false;
        if (where.projectId && diagram.projectId !== where.projectId) return false;
        if (where.status && diagram.status !== where.status) return false;
        return true;
      });
      if (!row) return null;
      return include?.liveDocEmbeds ? row : { ...row, liveDocEmbeds: undefined };
    },
    findMany: async ({ where, include, orderBy, take }: any) => {
      let rows = Array.from(store.projectDiagrams.values()).filter((diagram: any) => {
        if (where.projectId && diagram.projectId !== where.projectId) return false;
        if (where.id?.in && !where.id.in.includes(diagram.id)) return false;
        if (where.status && diagram.status !== where.status) return false;
        return true;
      });
      if (orderBy?.updatedAt === "desc") {
        rows.sort((left: any, right: any) => right.updatedAt.getTime() - left.updatedAt.getTime());
      }
      rows = rows.slice(0, take ?? rows.length);
      return include?.liveDocEmbeds ? rows : rows.map((row: any) => ({ ...row, liveDocEmbeds: undefined }));
    }
  };

  prisma.projectCodingRequirements = {
    findFirst: async ({ where, include, orderBy }: any) => {
      let rows = Array.from(store.projectCodingRequirements.values()).filter((row: any) => {
        if (where.id && row.id !== where.id) return false;
        if (where.projectId && row.projectId !== where.projectId) return false;
        if (where.artifactVersionId && row.artifactVersionId !== where.artifactVersionId) return false;
        const artifact = store.artifactVersions.get(row.artifactVersionId);
        if (where.artifactVersion?.artifactType && artifact?.artifactType !== where.artifactVersion.artifactType) return false;
        if (where.artifactVersion?.status && artifact?.status !== where.artifactVersion.status) return false;
        return true;
      });
      if (orderBy?.createdAt === "desc") {
        rows.sort((left: any, right: any) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      const row = rows[0];
      if (!row) return null;
      return {
        ...row,
        artifactVersion: include?.artifactVersion ? store.artifactVersions.get(row.artifactVersionId) : undefined,
        mermaidDiagram: include?.mermaidDiagram ? store.projectDiagrams.get(row.mermaidDiagramId) ?? null : undefined
      };
    },
    findMany: async ({ where, include, orderBy, take }: any) => {
      let rows = Array.from(store.projectCodingRequirements.values()).filter((row: any) => {
        if (where.projectId && row.projectId !== where.projectId) return false;
        const artifact = store.artifactVersions.get(row.artifactVersionId);
        if (where.artifactVersion?.artifactType && artifact?.artifactType !== where.artifactVersion.artifactType) return false;
        if (where.artifactVersion?.status && artifact?.status !== where.artifactVersion.status) return false;
        return true;
      });
      if (orderBy?.createdAt === "desc") {
        rows.sort((left: any, right: any) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      rows = rows.slice(0, take ?? rows.length);
      return rows.map((row: any) => ({
        ...row,
        artifactVersion: include?.artifactVersion ? store.artifactVersions.get(row.artifactVersionId) : undefined,
        mermaidDiagram: include?.mermaidDiagram ? store.projectDiagrams.get(row.mermaidDiagramId) ?? null : undefined
      }));
    }
  };

  prisma.projectContextEntry = {
    findFirst: async ({ where }: any) =>
      Array.from(store.projectContextEntries.values()).find((entry: any) => {
        if (where.id && entry.id !== where.id) return false;
        if (where.projectId && entry.projectId !== where.projectId) return false;
        if (where.status && entry.status !== where.status) return false;
        return true;
      }) ?? null
  };

  prisma.projectContextChunk = {
    findFirst: async ({ where }: any) =>
      Array.from(store.projectContextChunks.values()).find((chunk: any) => {
        if (where.id && chunk.id !== where.id) return false;
        if (where.projectId && chunk.projectId !== where.projectId) return false;
        if (where.contextEntryId && chunk.contextEntryId !== where.contextEntryId) return false;
        return true;
      }) ?? null,
    findMany: async ({ where, include, orderBy, take }: any) => {
      let rows = Array.from(store.projectContextChunks.values()).filter((chunk: any) => {
        if (where.projectId && chunk.projectId !== where.projectId) return false;
        if (where.contextEntry?.status) {
          const entry = store.projectContextEntries.get(chunk.contextEntryId);
          if (!entry || entry.status !== where.contextEntry.status) return false;
        }
        return true;
      });
      if (orderBy?.updatedAt === "desc") {
        rows.sort((left: any, right: any) => right.updatedAt.getTime() - left.updatedAt.getTime());
      }
      rows = rows.slice(0, take ?? rows.length);
      return rows.map((chunk: any) => {
        if (!include?.contextEntry) return chunk;
        const entry = store.projectContextEntries.get(chunk.contextEntryId);
        const attachments = Array.from(store.projectContextAttachments.values())
          .filter((attachment: any) => attachment.contextEntryId === chunk.contextEntryId)
          .sort((left: any, right: any) => left.createdAt.getTime() - right.createdAt.getTime());
        return { ...chunk, contextEntry: { ...entry, attachments } };
      });
    }
  };

  prisma.projectContextAttachment = {
    findFirst: async ({ where }: any) =>
      Array.from(store.projectContextAttachments.values()).find((attachment: any) => {
        if (where.id && attachment.id !== where.id) return false;
        if (where.projectId && attachment.projectId !== where.projectId) return false;
        if (where.contextEntryId && attachment.contextEntryId !== where.contextEntryId) return false;
        return true;
      }) ?? null
  };

  prisma.projectResponsibility = {
    findFirst: async ({ where }: any) =>
      Array.from(store.projectResponsibilities.values()).find((responsibility: any) => {
        if (where.id && responsibility.id !== where.id) return false;
        if (where.projectId && responsibility.projectId !== where.projectId) return false;
        return true;
      }) ?? null,
    findMany: async ({ where, include, orderBy, take }: any) => {
      let rows = Array.from(store.projectResponsibilities.values()).filter((responsibility: any) => {
        if (where.projectId && responsibility.projectId !== where.projectId) return false;
        if (where.id?.in && !where.id.in.includes(responsibility.id)) return false;
        return true;
      });
      if (Array.isArray(orderBy)) {
        rows.sort((left: any, right: any) => {
          if (left.status !== right.status) return String(left.status).localeCompare(String(right.status));
          return right.updatedAt.getTime() - left.updatedAt.getTime();
        });
      }
      rows = rows.slice(0, take ?? rows.length);
      return rows.map((responsibility: any) => {
        if (!include?.member) return responsibility;
        const member = responsibility.memberId ? Array.from(store.projectMembers.values()).find((item: any) => item.id === responsibility.memberId) : null;
        return { ...responsibility, member };
      });
    }
  };

  prisma.specChangeProposal = {
    findFirst: async ({ where, include }: any) => {
      const proposal = Array.from(store.specChangeProposals.values()).find((item: any) => {
        if (where.id && item.id !== where.id) return false;
        if (where.projectId && item.projectId !== where.projectId) return false;
        if (where.status && item.status !== where.status) return false;
        return true;
      });
      if (!proposal) return null;
      if (!include?.links) return proposal;
      const links = Array.from(store.specChangeLinks.values()).filter((link: any) => link.specChangeProposalId === proposal.id);
      return { ...proposal, links };
    },
    findMany: async ({ where, include, orderBy, take }: any) => {
      let rows = Array.from(store.specChangeProposals.values()).filter((proposal: any) => {
        if (where.projectId && proposal.projectId !== where.projectId) return false;
        if (where.status && proposal.status !== where.status) return false;
        if (where.status?.in && !where.status.in.includes(proposal.status)) return false;
        if (where.proposalType && proposal.proposalType !== where.proposalType) return false;
        if (where.OR && Array.isArray(where.OR) && where.OR.length > 0) {
          const ok = where.OR.some((clause: any) => {
            if (clause.title) return lexicalMatch(proposal.title, [clause.title.contains]);
            if (clause.summary) return lexicalMatch(proposal.summary, [clause.summary.contains]);
            return false;
          });
          if (!ok) return false;
        }
        return true;
      });
      if (orderBy?.acceptedAt === "desc" || orderBy?.createdAt === "desc") {
        rows.sort((left: any, right: any) => (right.acceptedAt?.getTime?.() ?? right.createdAt?.getTime?.() ?? 0) - (left.acceptedAt?.getTime?.() ?? left.createdAt?.getTime?.() ?? 0));
      }
      rows = rows.slice(0, take ?? rows.length);
      return rows.map((proposal: any) => {
        if (!include?.links) return proposal;
        return {
          ...proposal,
          links: Array.from(store.specChangeLinks.values()).filter((link: any) => link.specChangeProposalId === proposal.id)
        };
      });
    },
    create: async ({ data }: any) => {
      const id = fixtureUuid("proposal", `created:${store.specChangeProposals.size}:${data.title}`);
      const row = { id, createdAt: new Date(), updatedAt: new Date(), acceptedAt: null, acceptedBrainVersionId: null, decisionRecordId: data.decisionRecordId ?? null, ...data };
      store.specChangeProposals.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = store.specChangeProposals.get(where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }
  };

  prisma.specChangeLink = {
    findMany: async ({ where, include, take }: any) => {
      let rows = Array.from(store.specChangeLinks.values()).filter((link: any) => {
        if (where.projectId && link.projectId !== where.projectId) return false;
        if (where.specChangeProposalId && link.specChangeProposalId !== where.specChangeProposalId) return false;
        if (where.specChangeProposalId?.in && !where.specChangeProposalId.in.includes(link.specChangeProposalId)) return false;
        if (where.linkType && link.linkType !== where.linkType) return false;
        if (where.linkRefId && link.linkRefId !== where.linkRefId) return false;
        if (where.linkRefId?.in && !where.linkRefId.in.includes(link.linkRefId)) return false;
        if (where.proposal?.status) {
          const proposal = store.specChangeProposals.get(link.specChangeProposalId);
          if (!proposal || proposal.status !== where.proposal.status) return false;
        }
        return true;
      });
      if (take) rows = rows.slice(0, take);
      if (!include?.proposal) return rows;
      return rows.map((row: any) => ({
        ...row,
        proposal: store.specChangeProposals.get(row.specChangeProposalId) ?? null
      }));
    },
    createMany: async ({ data }: any) => {
      data.forEach((link: any, index: number) => {
        const id = fixtureUuid("proposal_link", `${link.specChangeProposalId}:${store.specChangeLinks.size}:${index}`);
        store.specChangeLinks.set(id, { id, ...link });
      });
      return { count: data.length };
    }
  };

  prisma.decisionRecord = {
    findFirst: async ({ where }: any) =>
      Array.from(store.decisionRecords.values()).find((decision: any) => {
        if (where.projectId && decision.projectId !== where.projectId) return false;
        if (where.id && decision.id !== where.id) return false;
        if (where.status && decision.status !== where.status) return false;
        if (where.status?.in && !where.status.in.includes(decision.status)) return false;
        if (where.OR && Array.isArray(where.OR) && where.OR.length > 0) {
          const ok = where.OR.some((clause: any) => {
            if (clause.title) return lexicalMatch(decision.title, [clause.title.contains]);
            if (clause.statement) return lexicalMatch(decision.statement, [clause.statement.contains]);
            return false;
          });
          if (!ok) return false;
        }
        return true;
      }) ?? null,
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = Array.from(store.decisionRecords.values()).filter((decision: any) => {
        if (where.projectId && decision.projectId !== where.projectId) return false;
        if (where.status && decision.status !== where.status) return false;
        if (where.status?.in && !where.status.in.includes(decision.status)) return false;
        if (where.OR && Array.isArray(where.OR) && where.OR.length > 0) {
          const ok = where.OR.some((clause: any) => {
            if (clause.title) return lexicalMatch(decision.title, [clause.title.contains]);
            if (clause.statement) return lexicalMatch(decision.statement, [clause.statement.contains]);
            return false;
          });
          if (!ok) return false;
        }
        return true;
      });
      if (orderBy?.acceptedAt === "desc" || orderBy?.createdAt === "desc") {
        rows.sort((left: any, right: any) => (right.acceptedAt?.getTime?.() ?? right.createdAt?.getTime?.() ?? 0) - (left.acceptedAt?.getTime?.() ?? left.createdAt?.getTime?.() ?? 0));
      }
      return rows.slice(0, take ?? rows.length);
    },
    create: async ({ data }: any) => {
      const id = fixtureUuid("decision", `created:${store.decisionRecords.size}:${data.title}`);
      const row = { id, createdAt: new Date(), ...data };
      store.decisionRecords.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = store.decisionRecords.get(where.id);
      Object.assign(row, data);
      return row;
    }
  };

  prisma.dashboardSnapshot = {
    findFirst: async ({ where, orderBy }: any) => {
      let rows = Array.from(store.dashboardSnapshots.values()).filter((snapshot: any) => {
        if (where.orgId && snapshot.orgId !== where.orgId) return false;
        if (where.projectId === null && snapshot.projectId !== null) return false;
        if (where.projectId && snapshot.projectId !== where.projectId) return false;
        if (where.scope && snapshot.scope !== where.scope) return false;
        return true;
      });
      if (orderBy?.computedAt === "desc") {
        rows.sort((left: any, right: any) => right.computedAt.getTime() - left.computedAt.getTime());
      }
      return rows[0] ?? null;
    }
  };

  prisma.agentRun = {
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = Array.from(store.agentRuns.values()).filter((run: any) => {
        if (where.projectId && run.projectId !== where.projectId) return false;
        if (where.status?.not && run.status === where.status.not) return false;
        return true;
      });
      if (orderBy?.updatedAt === "desc") rows.sort((left: any, right: any) => right.updatedAt.getTime() - left.updatedAt.getTime());
      return rows.slice(0, take ?? rows.length);
    },
    findFirst: async ({ where }: any) =>
      Array.from(store.agentRuns.values()).find((run: any) => {
        if (where.id && run.id !== where.id) return false;
        if (where.projectId && run.projectId !== where.projectId) return false;
        if (where.status?.not && run.status === where.status.not) return false;
        return true;
      }) ?? null
  };

  prisma.agentQualityReview = {
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = Array.from(store.agentQualityReviews.values()).filter((review: any) => {
        if (where.projectId && review.projectId !== where.projectId) return false;
        if (where.deletedAt === null && review.deletedAt !== null) return false;
        if (where.archivedAt === null && review.archivedAt !== null) return false;
        return true;
      });
      if (orderBy?.createdAt === "desc") rows.sort((left: any, right: any) => right.createdAt.getTime() - left.createdAt.getTime());
      return rows.slice(0, take ?? rows.length);
    },
    findFirst: async ({ where }: any) =>
      Array.from(store.agentQualityReviews.values()).find((review: any) => {
        if (where.id && review.id !== where.id) return false;
        if (where.projectId && review.projectId !== where.projectId) return false;
        if (where.deletedAt === null && review.deletedAt !== null) return false;
        if (where.archivedAt === null && review.archivedAt !== null) return false;
        return true;
      }) ?? null
  };

  prisma.communicationConnector = {
    findFirst: async ({ where }: any) =>
      Array.from(store.communicationConnectors.values()).find(
        (connector: any) =>
          (!where.id || connector.id === where.id) &&
          (!where.projectId || connector.projectId === where.projectId) &&
          (!where.provider || connector.provider === where.provider)
      ) ?? null
  };

  prisma.communicationThread = {
    findFirst: async ({ where, include }: any) => {
      const thread = Array.from(store.communicationThreads.values()).find(
        (item: any) => (!where.id || item.id === where.id) && (!where.projectId || item.projectId === where.projectId)
      );
      if (!thread) return null;
      if (!include?.messages) return thread;
      const messages = Array.from(store.communicationMessages.values())
        .filter((message: any) => message.threadId === thread.id)
        .sort((left: any, right: any) => right.sentAt.getTime() - left.sentAt.getTime())
        .slice(0, include.messages.take ?? Number.MAX_SAFE_INTEGER);
      return { ...thread, messages };
    },
    findFirstOrThrow: async (args: any) => {
      const row = await prisma.communicationThread.findFirst(args);
      if (!row) throw new Error("Thread not found");
      return row;
    },
    count: async ({ where }: any) =>
      Array.from(store.communicationThreads.values()).filter((thread: any) => {
        if (where.projectId && thread.projectId !== where.projectId) return false;
        if (where.id?.in && !where.id.in.includes(thread.id)) return false;
        if (where.id && !where.id.in && thread.id !== where.id) return false;
        return true;
      }).length
  };

  prisma.communicationMessage = {
    findFirst: async ({ where, include }: any) => {
      const message = Array.from(store.communicationMessages.values()).find((item: any) => {
        if (where.id && item.id !== where.id) return false;
        if (where.projectId && item.projectId !== where.projectId) return false;
        return true;
      });
      if (!message) return null;
      if (!include?.thread) return message;
      const thread = await prisma.communicationThread.findFirst({
        where: { id: message.threadId, projectId: message.projectId },
        include: include.thread.include ?? include.thread
      });
      return { ...message, thread };
    },
    findFirstOrThrow: async (args: any) => {
      const row = await prisma.communicationMessage.findFirst(args);
      if (!row) throw new Error("Message not found");
      return row;
    },
    findMany: async ({ where, include, orderBy, take }: any) => {
      let rows = Array.from(store.communicationMessages.values()).filter((message: any) => {
        if (where.projectId && message.projectId !== where.projectId) return false;
        if (where.bodyText?.not !== undefined && message.bodyText === where.bodyText.not) return false;
        if (where.id?.in && !where.id.in.includes(message.id)) return false;
        if (where.isDeletedByProvider !== undefined && message.isDeletedByProvider !== where.isDeletedByProvider) return false;
        return true;
      });
      if (orderBy?.sentAt === "desc") {
        rows.sort((left: any, right: any) => right.sentAt.getTime() - left.sentAt.getTime());
      }
      rows = rows.slice(0, take ?? rows.length);
      return rows.map((row: any) => {
        if (!include?.thread) {
          return row;
        }
        const thread = store.communicationThreads.get(row.threadId);
        return { ...row, thread, attachments: [] };
      });
    },
    count: async ({ where }: any) =>
      Array.from(store.communicationMessages.values()).filter((message: any) => {
        if (where.projectId && message.projectId !== where.projectId) return false;
        if (where.id?.in && !where.id.in.includes(message.id)) return false;
        return true;
      }).length,
    update: async ({ where, data }: any) => {
      const row = store.communicationMessages.get(where.id);
      Object.assign(row, data);
      return row;
    }
  };

  prisma.communicationMessageChunk = {
    findMany: async ({ where, select }: any) => {
      const rows = Array.from(store.communicationMessageChunks.values()).filter((chunk: any) =>
        !where.messageId?.in || where.messageId.in.includes(chunk.messageId)
      );
      if (!select?.messageId) return rows;
      return rows.map((row: any) => ({ messageId: row.messageId }));
    },
    create: async ({ data }: any) => {
      const id = fixtureUuid("message_chunk", `${data.messageId}:${data.chunkIndex}`);
      const row = { id, embedding: [0.1, 0.2], ...data };
      store.communicationMessageChunks.set(id, row);
      return row;
    }
  };

  prisma.communicationMessageRevision = {
    findFirst: async () => null,
    create: async ({ data }: any) => {
      const id = fixtureUuid("message_revision", `${store.communicationMessageRevisions.size}`);
      const row = { id, ...data };
      store.communicationMessageRevisions.set(id, row);
      return row;
    }
  };

  prisma.messageInsight = {
    upsert: async ({ where, create, update }: any) => {
      const existing = Array.from(store.messageInsights.values()).find(
        (item: any) => item.messageId === where.messageId_bodyHash.messageId && item.bodyHash === where.messageId_bodyHash.bodyHash
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const id = fixtureUuid("message_insight", `${create.messageId}:${store.messageInsights.size}`);
      const row = { id, generatedProposalId: null, generatedDecisionId: null, ...create };
      store.messageInsights.set(id, row);
      return row;
    },
    findFirstOrThrow: async ({ where, include }: any) => {
      const insight = Array.from(store.messageInsights.values()).find(
        (item: any) => (!where.id || item.id === where.id) && (!where.projectId || item.projectId === where.projectId)
      );
      if (!insight) throw new Error("Message insight not found");
      const result: any = { ...insight };
      if (include?.message) result.message = store.communicationMessages.get(insight.messageId) ?? null;
      if (include?.thread) result.thread = store.communicationThreads.get(insight.threadId) ?? null;
      if (include?.generatedProposal) result.generatedProposal = insight.generatedProposalId ? store.specChangeProposals.get(insight.generatedProposalId) : null;
      if (include?.generatedDecision) result.generatedDecision = insight.generatedDecisionId ? store.decisionRecords.get(insight.generatedDecisionId) : null;
      return result;
    },
    update: async ({ where, data }: any) => {
      const row = store.messageInsights.get(where.id);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of store.messageInsights.values()) {
        if (where.id && row.id !== where.id) continue;
        if (where.projectId && row.projectId !== where.projectId) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where }: any) =>
      Array.from(store.messageInsights.values()).filter((insight: any) => {
        if (where.projectId && insight.projectId !== where.projectId) return false;
        if (where.status?.in && !where.status.in.includes(insight.status)) return false;
        return true;
      })
  };

  prisma.threadInsight = {
    upsert: async ({ where, create, update }: any) => {
      const existing = Array.from(store.threadInsights.values()).find(
        (item: any) => item.threadId === where.threadId_threadStateHash.threadId && item.threadStateHash === where.threadId_threadStateHash.threadStateHash
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const id = fixtureUuid("thread_insight", `${create.threadId}:${store.threadInsights.size}`);
      const row = { id, generatedProposalId: null, generatedDecisionId: null, ...create };
      store.threadInsights.set(id, row);
      return row;
    },
    findFirstOrThrow: async ({ where }: any) => {
      const insight = Array.from(store.threadInsights.values()).find(
        (item: any) => (!where.id || item.id === where.id) && (!where.projectId || item.projectId === where.projectId)
      );
      if (!insight) throw new Error("Thread insight not found");
      return insight;
    },
    update: async ({ where, data }: any) => {
      const row = store.threadInsights.get(where.id);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of store.threadInsights.values()) {
        if (where.id && row.id !== where.id) continue;
        if (where.projectId && row.projectId !== where.projectId) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    }
  };

  prisma.jobRun = {
    upsert: async ({ where, create, update }: any) => {
      const existing = store.jobRuns.get(where.idempotencyKey);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      store.jobRuns.set(where.idempotencyKey, { id: fixtureUuid("job", where.idempotencyKey), ...create });
      return store.jobRuns.get(where.idempotencyKey);
    },
    update: async ({ where, data }: any) => {
      const row = store.jobRuns.get(where.idempotencyKey);
      if (row) Object.assign(row, data);
      return row;
    }
  };

  return prisma;
}

export function buildEvalWorld() {
  const store = makeStore();
  (Object.keys(FIXTURE_PROJECTS) as ProjectFixtureKey[]).forEach((projectFixture) => seedProject(store, projectFixture));
  store.dashboardSnapshots.set(fixtureUuid("dashboard", "general"), {
    id: fixtureUuid("dashboard", "general"),
    orgId: fixtureUuid("org", "default"),
    projectId: null,
    scope: "general",
    computedAt: new Date("2026-04-20T12:15:00.000Z"),
    payloadJson: {
      summary: "General dashboard snapshot",
      communication: {
        connectedProviders: 4,
        needsReview: 2
      }
    }
  });
  const alphaProjectId = fixtureUuid("project", "project_alpha");
  const alphaRunId = fixtureUuid("agent_run", "project_alpha:codex:auth");
  const alphaReviewId = fixtureUuid("agent_quality_review", "project_alpha:codex:auth");
  store.agentRuns.set(alphaRunId, {
    id: alphaRunId,
    orgId: fixtureUuid("org", "default"),
    projectId: alphaProjectId,
    contextPackId: fixtureUuid("agent_context_pack", "project_alpha:auth"),
    provider: "codex",
    agentLabel: "Codex",
    taskTitle: "Implement auth routes",
    status: "completed",
    humanReviewResult: "unreviewed",
    requiresHumanReview: true,
    outputSummary: "Codex claimed it implemented auth routes but did not record docs updates.",
    retrievalSummary: "Codex auth route implementation evidence.",
    filesChangedJson: ["src/modules/auth/routes.ts"],
    risksFoundJson: ["Possible missing rate-limit test"],
    followUpQuestionsJson: ["Should auth errors be documented for frontend?"],
    branchName: "feature/auth-routes",
    commitSha: null,
    prUrl: null,
    updatedAt: new Date("2026-04-20T13:00:00.000Z"),
    createdAt: new Date("2026-04-20T12:45:00.000Z")
  });
  store.agentQualityReviews.set(alphaReviewId, {
    id: alphaReviewId,
    orgId: fixtureUuid("org", "default"),
    projectId: alphaProjectId,
    contextPackId: fixtureUuid("agent_context_pack", "project_alpha:auth"),
    agentRunId: alphaRunId,
    reviewType: "agent_run_review",
    status: "completed_with_warnings",
    scoreLabel: "usable_with_warnings",
    recommendation: "needs_follow_up",
    overallScore: 71,
    needsFollowUp: true,
    highSeverityFindingCount: 1,
    criticalFindingCount: 0,
    summary: "Review found the Codex run appears aligned on auth routing but has a test gap and missing docs evidence.",
    findingsJson: ["Possible drift: tests were claimed but no concrete test run was recorded."],
    missingRequirementsJson: ["Document auth error contract for frontend consumers."],
    testGapsJson: ["No recorded auth rate-limit test."],
    docsGapsJson: ["No docsUpdated entry for the auth route contract."],
    openQuestionsJson: ["Should auth errors be documented for frontend?"],
    retrievalSummary: "Step 5 review: Codex auth run needs follow-up for tests and docs.",
    deletedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-04-20T13:05:00.000Z"),
    updatedAt: new Date("2026-04-20T13:05:00.000Z")
  });

  const prisma = buildPrisma(store);
  const jobs = noOpJobs();
  const auditService = new AuditService(prisma);
  const projectService = new ProjectService(prisma, auditService, jobs as any);
  const generationProvider = new MockGenerationProvider();
  const embeddingProvider = new MockEmbeddingProvider();
  const impactResolver = new ImpactResolverService(prisma);
  const evalEnv = {
    ...makeEnv(),
    BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED: true,
    BETA_COMMUNICATION_AUTO_CLASSIFY_ENABLED: true,
    BETA_COMMUNICATION_AUTO_CANDIDATES_ENABLED: true,
    BETA_COMMUNICATION_AUTO_PROPOSALS_ENABLED: true
  } as any;
  const proposalService = new CommunicationProposalsService(prisma, projectService, auditService, jobs as any, evalEnv);
  const telemetry = noOpTelemetry();

  const socratesService = new SocratesService(
    prisma,
    evalEnv,
    generationProvider,
    embeddingProvider,
    projectService,
    auditService
  );

  const messageInsightsService = new MessageInsightsService(
    prisma,
    generationProvider,
    projectService,
    auditService,
    jobs as any,
    impactResolver,
    proposalService,
    telemetry as any,
    evalEnv
  );

  const threadInsightsService = new ThreadInsightsService(
    prisma,
    generationProvider,
    projectService,
    auditService,
    jobs as any,
    impactResolver,
    proposalService,
    telemetry as any,
    evalEnv
  );

  function resolveProjectId(projectFixture: ProjectFixtureKey) {
    return fixtureUuid("project", projectFixture);
  }

  function resolveUserId(role: "manager" | "dev" | "client") {
    return fixtureUuid("user", role);
  }

  function resolveDocumentId(projectFixture: ProjectFixtureKey, key: string) {
    return fixtureUuid("document", `${resolveProjectId(projectFixture)}:${key}`);
  }

  function resolveDocumentVersionId(projectFixture: ProjectFixtureKey, key: string) {
    return fixtureUuid("document_version", `${resolveProjectId(projectFixture)}:${key}:v1`);
  }

  function resolveSectionId(projectFixture: ProjectFixtureKey, documentKey: string, anchorId: string) {
    return fixtureUuid("document_section", `${resolveProjectId(projectFixture)}:${documentKey}:${anchorId}`);
  }

  function addFixtureMessages(projectFixture: ProjectFixtureKey, messageKeys: string[]) {
    const connectorId = fixtureUuid("connector", `${projectFixture}:manual_import`);
    const results: Record<string, { threadId: string; messageId: string }> = {};
    for (const key of messageKeys) {
      const projectId = resolveProjectId(projectFixture);
      if (key === "mvp_manual_context_note") {
        createContextEntry(store, projectId, "mvp_manual_context_note", {
          type: "meeting_note",
          title: "Manual kickoff notes",
          rawText: "Manual context note: Sara confirmed manager approval is the first MVP workflow and weekly reporting follows it.",
          importance: "high"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_decision_context_note") {
        createContextEntry(store, projectId, "mvp_decision_context_note", {
          type: "decision_note",
          title: "Manual MVP decision note",
          rawText: "Decision note: keep the MVP scoped to manual import, Fireflies, Slack, ClickUp, Granola, and Teams; do not add direct Gmail, Outlook, or WhatsApp provider setup for pilot.",
          importance: "high"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_team_context_note") {
        createContextEntry(store, projectId, "mvp_team_context_note", {
          type: "team_note",
          title: "Team ownership note",
          rawText: "Team note: Sara owns frontend screens, Ali owns backend APIs, and Nia owns QA smoke verification.",
          importance: "high"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_task_context_note") {
        createContextEntry(store, projectId, "mvp_task_context_note", {
          type: "task_note",
          title: "Blocked task note",
          rawText: "Task note: backend approval API remains blocked until the approval copy is finalized.",
          importance: "high"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_chat_export_context") {
        createContextEntry(store, projectId, "mvp_chat_export_context", {
          type: "manual_note",
          title: "WhatsApp text export",
          rawText: "Chat export: customer asked to import WhatsApp text manually for MVP instead of connecting WhatsApp Business directly.",
          importance: "high"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_deleted_context_note") {
        createContextEntry(store, projectId, "mvp_deleted_context_note", {
          type: "manual_note",
          title: "Deleted vendor note",
          rawText: "Deleted context: use VendorX biometric KYC for launch.",
          status: "deleted"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_wrong_project_context_note") {
        createContextEntry(store, resolveProjectId("project_beta"), "mvp_wrong_project_context_note", {
          type: "manual_note",
          title: "Wrong project note",
          rawText: "Wrong-project context: Project Alpha should use a drone dispatch module."
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_image_caption_context") {
        createContextEntry(store, projectId, "mvp_image_caption_context", {
          type: "screenshot_caption",
          title: "Assignment approval chart screenshot",
          rawText: "Socrates only has the user-provided caption/description for this screenshot. Caption: chart shows manager approval before assignment activation and weekly reporting after activation.",
          contextualText: "Evidence limitation: captioned image context only. Assignment approval chart screenshot caption says manager approval happens before assignment activation, then weekly reporting follows.",
          attachment: {
            attachmentKind: "image",
            mimeType: "image/png",
            originalFilename: "assignment-approval-chart.png",
            caption: "Chart shows manager approval before assignment activation and weekly reporting after activation.",
            description: "Caption-only screenshot evidence; no OCR is available."
          }
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_chart_caption_context") {
        createContextEntry(store, projectId, "mvp_chart_caption_context", {
          type: "chart_caption",
          title: "Weekly reporting funnel chart",
          rawText: "Socrates only has the user-provided caption/description for this chart. Caption: funnel shows assignment approval, activation, and weekly reporting checkpoints.",
          contextualText: "Caption-only chart context. The user-provided caption says assignment approval leads to activation and then weekly reporting checkpoints.",
          attachment: {
            attachmentKind: "image",
            mimeType: "image/png",
            originalFilename: "weekly-reporting-funnel.png",
            caption: "Funnel shows assignment approval, activation, and weekly reporting checkpoints.",
            description: "Caption-only chart evidence; no OCR is available."
          }
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_whatsapp_screenshot_context") {
        createContextEntry(store, projectId, "mvp_whatsapp_screenshot_context", {
          type: "screenshot_caption",
          title: "WhatsApp screenshot context",
          rawText: "Socrates only has the user-provided caption/description for this screenshot. Caption: WhatsApp screenshot says pilot feedback must be imported manually, not connected as a direct provider.",
          contextualText: "Caption-only WhatsApp screenshot context. The caption says pilot feedback should be imported manually and WhatsApp Business direct sync is out of MVP scope.",
          attachment: {
            attachmentKind: "image",
            mimeType: "image/png",
            originalFilename: "whatsapp-feedback.png",
            caption: "WhatsApp screenshot says pilot feedback must be imported manually, not connected as a direct provider.",
            description: "Caption-only WhatsApp screenshot evidence; no OCR is available."
          }
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_deleted_image_context") {
        createContextEntry(store, projectId, "mvp_deleted_image_context", {
          type: "screenshot_caption",
          title: "Deleted image context",
          rawText: "Deleted image context: screenshot claims Stripe payouts are required for MVP.",
          status: "deleted",
          attachment: {
            attachmentKind: "image",
            mimeType: "image/png",
            originalFilename: "deleted-stripe.png",
            caption: "Stripe payouts are required for MVP.",
            description: "Deleted caption-only evidence."
          }
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_responsibility_backend") {
        createResponsibility(store, projectId, "mvp_responsibility_backend", {
          memberRole: "dev",
          title: "Build assignment approval backend",
          description: "Ali owns backend manager approval before assignment activation. The task is blocked until API approval copy is confirmed.",
          area: "backend",
          status: "blocked"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_responsibility_frontend") {
        createResponsibility(store, projectId, "mvp_responsibility_frontend", {
          assigneeName: "Sara",
          title: "Build MVP frontend screens",
          description: "Sara owns frontend project dashboard, context upload, and Socrates panel surfaces.",
          area: "frontend",
          status: "in_progress"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_responsibility_auth") {
        createResponsibility(store, projectId, "mvp_responsibility_auth", {
          memberRole: "manager",
          title: "Own MVP authentication setup",
          description: "Manager owns invite-only authentication setup and access review.",
          area: "backend",
          status: "open"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      if (key === "mvp_responsibility_done") {
        createResponsibility(store, projectId, "mvp_responsibility_done", {
          assigneeName: "Nia",
          title: "Complete smoke checklist",
          description: "Nia completed MVP dry-run and mock smoke checklist review.",
          area: "qa",
          status: "done"
        });
        results[key] = { threadId: "", messageId: "" };
        continue;
      }
      const fixture = MESSAGE_FIXTURES[key];
      if (!fixture) {
        throw new Error(`Unknown message fixture: ${key}`);
      }
      const { threadId, messageId } = createThreadWithMessage(store, projectId, connectorId, key, fixture);
      results[key] = { threadId, messageId };
    }
    return results;
  }

  return {
    store,
    prisma,
    services: {
      socratesService,
      messageInsightsService,
      threadInsightsService,
      proposalService
    },
    refs: {
      resolveProjectId,
      resolveUserId,
      resolveDocumentId,
      resolveDocumentVersionId,
      resolveSectionId,
      fixtureUuid
    },
    addFixtureMessages
  };
}
