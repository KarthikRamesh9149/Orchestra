export const communicationProviders = [
  "manual_import",
  "slack",
  "gmail",
  "outlook",
  "microsoft_teams",
  "whatsapp_business",
  "fireflies_ai",
  "clickup",
  "granola",
  "zoho_mail",
  "zoho_cliq",
  "zoho_crm",
  "notion"
] as const;

export type CommunicationProviderName = (typeof communicationProviders)[number];
export type CommunicationEvidenceKind =
  | "manual_evidence"
  | "conversation_evidence"
  | "meeting_evidence"
  | "task_work_status_evidence"
  | "document_workspace_evidence";

export interface CommunicationProviderMetadata {
  provider: CommunicationProviderName;
  displayName: string;
  category: "manual" | "conversation" | "meeting" | "task_work_status" | "document_workspace";
  evidenceKind: CommunicationEvidenceKind;
  description: string;
  normalizesTo: "communication_threads_messages" | "project_memory_documents_or_evidence";
  readFirst: true;
  truthGated: true;
  mutatesProductBrain: false;
  mutatesLiveDoc: false;
  writeActionsEnabled: false;
  step1Scope?: "foundation_only" | "implemented";
  deferredFeatures?: string[];
}

export const communicationProviderMetadata: Record<CommunicationProviderName, CommunicationProviderMetadata> = {
  manual_import: {
    provider: "manual_import",
    displayName: "Manual Import",
    category: "manual",
    evidenceKind: "manual_evidence",
    description: "Paste-in notes, transcripts, and exported communication evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false
  },
  slack: {
    provider: "slack",
    displayName: "Slack",
    category: "conversation",
    evidenceKind: "conversation_evidence",
    description: "Workspace/channel/thread/message conversation evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false
  },
  gmail: {
    provider: "gmail",
    displayName: "Gmail",
    category: "conversation",
    evidenceKind: "conversation_evidence",
    description: "Email thread and message evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false
  },
  outlook: {
    provider: "outlook",
    displayName: "Outlook",
    category: "conversation",
    evidenceKind: "conversation_evidence",
    description: "Microsoft Outlook email thread and message evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false
  },
  microsoft_teams: {
    provider: "microsoft_teams",
    displayName: "Microsoft Teams",
    category: "conversation",
    evidenceKind: "conversation_evidence",
    description: "selected Teams/channel/chat evidence",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false,
    step1Scope: "implemented",
    deferredFeatures: ["teams_webhooks", "teams_write_actions"]
  },
  whatsapp_business: {
    provider: "whatsapp_business",
    displayName: "WhatsApp Business",
    category: "conversation",
    evidenceKind: "conversation_evidence",
    description: "Inbound WhatsApp Business conversation evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false
  },
  fireflies_ai: {
    provider: "fireflies_ai",
    displayName: "Fireflies.ai",
    category: "meeting",
    evidenceKind: "meeting_evidence",
    description: "Completed meeting transcript evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false
  },
  clickup: {
    provider: "clickup",
    displayName: "ClickUp",
    category: "task_work_status",
    evidenceKind: "task_work_status_evidence",
    description: "Task, task comment, and work-status evidence normalized as communication evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false,
    step1Scope: "implemented",
    deferredFeatures: ["clickup_write_actions", "clickup_attachment_ingestion", "clickup_docs_ingestion"]
  },
  granola: {
    provider: "granola",
    displayName: "Granola",
    category: "meeting",
    evidenceKind: "meeting_evidence",
    description: "Granola meeting notes, summaries, and transcript evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false,
    step1Scope: "implemented",
    deferredFeatures: [
      "granola_webhooks",
      "granola_write_actions",
      "granola_note_creation",
      "granola_note_update",
      "granola_audio_sync"
    ]
  },
  zoho_mail: {
    provider: "zoho_mail",
    displayName: "Zoho Mail",
    category: "conversation",
    evidenceKind: "conversation_evidence",
    description: "Zoho Mail account, folder, email thread, and message evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false,
    step1Scope: "implemented",
    deferredFeatures: [
      "zoho_mail_send",
      "zoho_mail_reply",
      "zoho_mail_delete",
      "zoho_mail_mark_read",
      "zoho_mail_move",
      "zoho_mail_labels",
      "zoho_mail_attachment_ingestion"
    ]
  },
  zoho_cliq: {
    provider: "zoho_cliq",
    displayName: "Zoho Cliq",
    category: "conversation",
    evidenceKind: "conversation_evidence",
    description: "Zoho Cliq channel, chat, thread, and message evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false,
    step1Scope: "implemented",
    deferredFeatures: [
      "zoho_cliq_post_message",
      "zoho_cliq_edit_message",
      "zoho_cliq_delete_message",
      "zoho_cliq_reactions",
      "zoho_cliq_join_leave",
      "zoho_cliq_bot_actions"
    ]
  },
  zoho_crm: {
    provider: "zoho_crm",
    displayName: "Zoho CRM",
    category: "task_work_status",
    evidenceKind: "task_work_status_evidence",
    description: "Zoho CRM Leads, Accounts, Contacts, Deals, Tasks, Calls, Meetings, Notes, and customer/business status evidence.",
    normalizesTo: "communication_threads_messages",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false,
    step1Scope: "implemented",
    deferredFeatures: [
      "zoho_crm_create_records",
      "zoho_crm_update_records",
      "zoho_crm_delete_records",
      "zoho_crm_writeback",
      "zoho_crm_automation"
    ]
  },
  notion: {
    provider: "notion",
    displayName: "Notion",
    category: "document_workspace",
    evidenceKind: "document_workspace_evidence",
    description: "selected/shared Notion pages and databases as project knowledge evidence",
    normalizesTo: "project_memory_documents_or_evidence",
    readFirst: true,
    truthGated: true,
    mutatesProductBrain: false,
    mutatesLiveDoc: false,
    writeActionsEnabled: false,
    step1Scope: "implemented",
    deferredFeatures: [
      "notion_comment_ingestion",
      "notion_write_actions"
    ]
  }
};

export const implementedCommunicationProviders = [
  "manual_import",
  "slack",
  "gmail",
  "outlook",
  "microsoft_teams",
  "whatsapp_business",
  "fireflies_ai",
  "clickup",
  "granola",
  "zoho_mail",
  "zoho_cliq",
  "zoho_crm",
  "notion"
] as const;

export function isImplementedCommunicationProvider(provider: CommunicationProviderName) {
  return implementedCommunicationProviders.includes(provider as (typeof implementedCommunicationProviders)[number]);
}

export function getCommunicationProviderMetadata(provider: CommunicationProviderName) {
  return communicationProviderMetadata[provider];
}
