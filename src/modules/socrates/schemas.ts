import { z } from "zod";
import { suggestedActionSchema } from "./actions.schemas.js";

// ---------------------------------------------------------------------------
// Session / context schemas
// ---------------------------------------------------------------------------

export const pageContextEnum = z.enum([
  "dashboard_general",
  "dashboard_project",
  "brain_overview",
  "brain_graph",
  "doc_viewer",
  "live_doc",
  "coding_requirements",
  "client_view",
]);
export type PageContext = z.infer<typeof pageContextEnum>;

export const selectedRefTypeEnum = z.enum([
  "document",
  "document_section",
  "live_doc_section",
  "brain_node",
  "change_proposal",
  "decision_record",
  "dashboard_scope",
  "project_diagram",
  "coding_requirements",
]);

export const viewerStateSchema = z.object({
  documentId: z.string().uuid().optional(),
  documentVersionId: z.string().uuid().optional(),
  pageNumber: z.number().int().positive().optional(),
  anchorId: z.string().optional(),
  sectionKey: z.string().optional(),
  scrollHint: z.string().optional(),
});

export const createSessionBodySchema = z.object({
  pageContext: pageContextEnum,
  selectedRefType: selectedRefTypeEnum.optional(),
  selectedRefId: z.string().min(1).max(200).optional(),
  viewerState: viewerStateSchema.optional(),
}).superRefine((value, context) => {
  const hasSelectedRefType = value.selectedRefType !== undefined;
  const hasSelectedRefId = value.selectedRefId !== undefined;
  if (hasSelectedRefType !== hasSelectedRefId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasSelectedRefType ? ["selectedRefId"] : ["selectedRefType"],
      message: "selectedRefType and selectedRefId must be provided together",
    });
  }
});

export const patchContextBodySchema = z.object({
  pageContext: pageContextEnum.optional(),
  selectedRefType: selectedRefTypeEnum.optional().nullable(),
  selectedRefId: z.string().min(1).max(200).optional().nullable(),
  viewerState: viewerStateSchema.optional().nullable(),
}).superRefine((value, context) => {
  const hasSelectedRefType = Object.prototype.hasOwnProperty.call(value, "selectedRefType");
  const hasSelectedRefId = Object.prototype.hasOwnProperty.call(value, "selectedRefId");
  if (hasSelectedRefType !== hasSelectedRefId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasSelectedRefType ? ["selectedRefId"] : ["selectedRefType"],
      message: "selectedRefType and selectedRefId must be updated together",
    });
    return;
  }

  if (hasSelectedRefType && hasSelectedRefId) {
    const cleared = value.selectedRefType === null && value.selectedRefId === null;
    const setTogether = value.selectedRefType !== null && value.selectedRefId !== null;
    if (!cleared && !setTogether) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedRefId"],
        message: "selectedRefType and selectedRefId must either both be null or both be set",
      });
    }
  }
});

export const sessionParamsSchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

export const socratesFeedbackParamsSchema = sessionParamsSchema.extend({
  assistantMessageId: z.string().uuid()
});

export const socratesFeedbackBodySchema = z.object({
  reason: z.enum(["helpful", "incorrect", "outdated", "missing_evidence", "wrong_source", "wrong_current_truth"]),
  correctionText: z.string().trim().max(2000).optional().nullable()
}).superRefine((value, context) => {
  if (value.reason !== "helpful" && value.correctionText !== undefined && value.correctionText !== null && !value.correctionText.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["correctionText"], message: "Correction text cannot be blank" });
  }
});

export const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Message stream schemas
// ---------------------------------------------------------------------------

export const streamMessageBodySchema = z.object({
  content: z.string().min(1).max(8000),
});

export const socratesV1ModeSchema = z.enum([
  "ask",
  "artifact",
  "api_map",
  "weekly_summary",
  "system_diagram",
  "ownership",
  "timeline_view"
]);

export const socratesV1SourceSchema = z.enum([
  "all",
  "documents",
  "slack",
  "communications",
  "timeline",
  "activity",
  "live_doc",
  "socrates_history",
  "team",
  "subscriptions",
  "github",
  "google_drive",
  "notion",
  "vscode"
]);

export const socratesV1AskBodySchema = z.object({
  question: z.string().trim().min(1).max(8000).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
  prompt: z.string().trim().min(1).max(8000).optional(),
  sessionId: z.string().uuid().optional().nullable(),
  mode: socratesV1ModeSchema.optional().default("ask"),
  selectedSources: z.array(socratesV1SourceSchema).max(10).optional(),
  maxEvidence: z.number().int().min(1).max(50).optional(),
  includeArtifacts: z.boolean().optional().default(true),
  includeHistory: z.boolean().optional().default(true),
  clientContext: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, context) => {
  if (!value.question && !value.content && !value.prompt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["question"],
      message: "question, content, or prompt is required"
    });
  }
});

export type SocratesV1AskBody = z.infer<typeof socratesV1AskBodySchema>;
export type SocratesV1Mode = z.infer<typeof socratesV1ModeSchema>;

// ---------------------------------------------------------------------------
// AI answer output schema (validated before persistence)
// ---------------------------------------------------------------------------

export const citationSchema = z.object({
  type: z.enum([
    "live_doc_section",
    "document_section",
    "document_chunk",
    "google_drive_document",
    "message",
    "brain_node",
    "product_brain",
    "change_proposal",
    "decision_record",
    "dashboard_snapshot",
    "project_responsibility",
    "project_context",
    "project_diagram",
    "coding_requirements",
    "agent_run",
    "agent_quality_review",
    "agent_markdown_file",
    "agent_markdown_file_version",
    "agent_markdown_quality_report",
    "agent_markdown_drift_report",
    "agent_markdown_sync_run",
  ]),
  refId: z.string().min(1).max(200),
  label: z.string(),
  pageNumber: z.number().int().positive().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();

export const openTargetRefSchema = z.union([
  z.object({
    targetType: z.literal("live_doc_section"),
    targetRef: z.object({
      sectionKey: z.string().min(1).max(200),
      diagramId: z.string().uuid().optional(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("document_section"),
    targetRef: z.object({
      documentId: z.string().uuid().optional(),
      documentVersionId: z.string().uuid().optional(),
      anchorId: z.string(),
      pageNumber: z.number().int().positive().optional(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("google_drive_file"),
    targetRef: z.object({
      driveFileId: z.string().uuid(),
      driveProviderFileId: z.string().min(1).max(300).optional(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("message"),
    targetRef: z.object({
      messageId: z.string().uuid(),
      threadId: z.string().uuid().optional(),
      highlightChunkId: z.string().uuid().optional(),
      provider: z.enum(["slack", "clickup", "granola", "fireflies_ai", "manual_import"]).optional(),
      connectorId: z.string().uuid().optional(),
      channelId: z.string().min(1).max(200).optional(),
      channelName: z.string().min(1).max(200).optional(),
      teamId: z.string().min(1).max(200).optional(),
      teamName: z.string().min(1).max(200).optional(),
      sender: z.string().min(1).max(200).optional(),
      sentAt: z.string().datetime().optional(),
      providerPermalink: z.string().url().optional(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("thread"),
    targetRef: z.object({ threadId: z.string().uuid() }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("brain_node"),
    targetRef: z.object({ nodeId: z.string().uuid(), artifactVersionId: z.string().uuid().optional() }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("change_proposal"),
    targetRef: z.object({ proposalId: z.string().uuid() }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("decision_record"),
    targetRef: z.object({ decisionId: z.string().uuid() }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("dashboard_filter"),
    targetRef: z.object({ filter: z.string(), value: z.string().optional() }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("project_responsibility"),
    targetRef: z.object({ projectId: z.string().uuid(), responsibilityId: z.string().uuid() }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("project_context"),
    targetRef: z.object({
      projectId: z.string().uuid(),
      contextId: z.string().uuid(),
      contextChunkId: z.string().uuid().optional(),
      attachmentId: z.string().uuid().optional(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("project_diagram"),
    targetRef: z.object({
      projectId: z.string().uuid(),
      diagramId: z.string().uuid(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("coding_requirements"),
    targetRef: z.object({
      projectId: z.string().uuid(),
      codingRequirementsId: z.string().uuid(),
      artifactVersionId: z.string().uuid(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("project_event"),
    targetRef: z.object({
      projectId: z.string().uuid(),
      eventId: z.string().uuid(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("agent_run"),
    targetRef: z.object({
      agentRunId: z.string().uuid(),
      contextPackId: z.string().uuid().optional(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("agent_quality_review"),
    targetRef: z.object({
      reviewId: z.string().uuid(),
      agentRunId: z.string().uuid().optional(),
      contextPackId: z.string().uuid().optional(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("agent_markdown_file"),
    targetRef: z.object({
      fileSetId: z.string().uuid(),
      fileId: z.string().uuid(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("agent_markdown_file_version"),
    targetRef: z.object({
      fileSetId: z.string().uuid(),
      fileId: z.string().uuid(),
      versionId: z.string().uuid(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("agent_markdown_quality_report"),
    targetRef: z.object({
      fileSetId: z.string().uuid(),
      reportId: z.string().uuid(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("agent_markdown_drift_report"),
    targetRef: z.object({
      fileSetId: z.string().uuid(),
      reportId: z.string().uuid(),
    }).strict(),
  }).strict(),
  z.object({
    targetType: z.literal("agent_markdown_sync_run"),
    targetRef: z.object({
      fileSetId: z.string().uuid(),
      syncRunId: z.string().uuid(),
    }).strict(),
  }).strict(),
]);

export const answerSchema = z.object({
  answer_md: z.string().min(1),
  citations: z.array(citationSchema),
  open_targets: z.array(openTargetRefSchema),
  suggested_prompts: z.array(z.string().trim().min(1).max(200)).max(5),
  suggested_actions: z.array(suggestedActionSchema).max(5).default([]),
  confidence: z.enum(["high", "medium", "low"]),
  limitations: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict();

export type AnswerSchema = z.infer<typeof answerSchema>;
export type CitationSchema = z.infer<typeof citationSchema>;
export type OpenTargetRef = z.infer<typeof openTargetRefSchema>;
