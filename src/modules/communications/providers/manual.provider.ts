import type { NormalizedCommunicationBatch } from "../../../lib/communications/provider-normalized-types.js";
import { manualImportBodySchema } from "../schemas.js";
import type { CommunicationProviderAdapter } from "./provider.interface.js";

export class ManualImportProvider implements CommunicationProviderAdapter {
  readonly provider = "manual_import" as const;

  async connect() {
    return {
      mode: "connected" as const,
      status: "connected" as const,
      accountLabel: "Manual import"
    };
  }

  async sync() {
    return {
      queued: false,
      summary: {
        mode: "noop",
        reason: "manual_import has no external sync source in C1"
      }
    };
  }

  async normalizeImport(input: unknown): Promise<NormalizedCommunicationBatch> {
    const parsed = manualImportBodySchema.parse(input);
    return {
      projectId: "",
      connectorId: "",
      provider: "manual_import",
      threads: [
        {
          providerThreadId: parsed.thread.providerThreadId,
          subject: parsed.thread.subject ?? null,
          participants: parsed.thread.participants,
          startedAt: parsed.thread.startedAt ?? null,
          threadUrl: parsed.thread.threadUrl ?? null,
          rawMetadata: parsed.thread.rawMetadata ?? null
        }
      ],
      messages: parsed.messages.map((message) => ({
        providerMessageId: message.providerMessageId,
        senderLabel: message.senderLabel,
        senderExternalRef: message.senderExternalRef ?? null,
        senderEmail: message.senderEmail ?? null,
        sentAt: message.sentAt,
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml ?? null,
        messageType: message.messageType,
        providerPermalink: message.providerPermalink ?? null,
        replyToProviderMessageId: message.replyToProviderMessageId ?? null,
        rawMetadata: message.rawMetadata ?? null,
        attachments: message.attachments
      }))
    };
  }
}
