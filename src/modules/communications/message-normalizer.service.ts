import type { CommunicationProvider } from "@prisma/client";
import { createHash } from "node:crypto";
import type {
  NormalizedAttachment,
  NormalizedCommunicationBatch,
  NormalizedMessage,
  NormalizedThread
} from "../../lib/communications/provider-normalized-types.js";
import { htmlToText } from "../../lib/communications/html-to-text.js";

export class MessageNormalizerService {
  normalizeBatch(input: NormalizedCommunicationBatch): NormalizedCommunicationBatch {
    return {
      ...input,
      threads: input.threads.map((thread) => this.normalizeThread(thread)),
      messages: input.messages.map((message, index) => this.normalizeMessage(message, input.provider, index))
    };
  }

  private normalizeThread(thread: NormalizedThread): NormalizedThread {
    return {
      ...thread,
      subject: thread.subject?.trim() || null,
      participants: thread.participants.map((participant) => ({
        label: participant.label.trim(),
        externalRef: participant.externalRef?.trim() || null,
        email: participant.email?.trim().toLowerCase() || null
      }))
    };
  }

  private normalizeMessage(
    message: NormalizedMessage,
    provider: CommunicationProvider,
    index: number
  ): NormalizedMessage {
    const bodyText = message.bodyText.trim() || (message.bodyHtml ? htmlToText(message.bodyHtml) : "");
    if (!bodyText) {
      throw new Error(`Imported message ${message.providerMessageId} cannot be empty`);
    }

    return {
      ...message,
      bodyText,
      bodyHtml: message.bodyHtml ?? null,
      senderLabel: message.senderLabel.trim(),
      senderExternalRef: message.senderExternalRef?.trim() || null,
      senderEmail: message.senderEmail?.trim().toLowerCase() || null,
      providerPermalink: message.providerPermalink?.trim() || null,
      replyToProviderMessageId: message.replyToProviderMessageId?.trim() || null,
      attachments: (message.attachments ?? []).map((attachment, attachmentIndex) =>
        this.normalizeAttachment(attachment, provider, message.providerMessageId, index, attachmentIndex)
      )
    };
  }

  private normalizeAttachment(
    attachment: NormalizedAttachment,
    provider: CommunicationProvider,
    providerMessageId: string,
    messageIndex: number,
    attachmentIndex: number
  ): NormalizedAttachment {
    const filename = attachment.filename?.trim() || null;
    const providerUrl = attachment.providerUrl?.trim() || null;
    const providerAttachmentId =
      attachment.providerAttachmentId?.trim() ||
      createHash("sha256")
        .update(`${provider}:${providerMessageId}:${messageIndex}:${attachmentIndex}:${filename ?? ""}:${providerUrl ?? ""}`)
        .digest("hex");

    return {
      ...attachment,
      providerAttachmentId,
      filename,
      mimeType: attachment.mimeType?.trim() || null,
      providerUrl
    };
  }
}
