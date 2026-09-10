import {
  buildMessageContextualRetrievalText,
  buildMessageLexicalRetrievalText
} from "../retrieval/contextualize.js";

export function normalizeSubject(subject?: string | null) {
  return subject?.trim().toLowerCase() || null;
}

export function buildMessageContextualContent(input: {
  provider: string;
  senderLabel: string;
  senderEmail?: string | null;
  sentAt: Date;
  bodyText: string;
  thread: { subject?: string | null; participantsJson?: unknown };
  attachmentNames?: string[];
}) {
  const participants = Array.isArray(input.thread.participantsJson)
    ? input.thread.participantsJson
        .map((value) => {
          if (typeof value !== "object" || value === null) {
            return null;
          }

          const participant = value as { label?: unknown; externalRef?: unknown; email?: unknown };
          return [participant.label, participant.externalRef, participant.email]
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .join(" ");
        })
        .filter((value): value is string => Boolean(value))
    : [];

  return buildMessageContextualRetrievalText({
    provider: input.provider,
    threadSubject: input.thread.subject,
    participants,
    senderLabel: input.senderLabel,
    senderEmail: input.senderEmail,
    sentAt: input.sentAt,
    bodyText: input.bodyText,
    attachmentNames: input.attachmentNames
  });
}

export function buildMessageLexicalContent(input: {
  bodyText: string;
  senderLabel: string;
  senderEmail?: string | null;
  subject?: string | null;
  attachmentNames?: string[];
}) {
  return buildMessageLexicalRetrievalText(input);
}
