interface DocumentContextualRetrievalInput {
  content: string;
  documentTitle: string;
  kind: string;
  headingPath?: string[];
  pageNumber?: number | null;
  projectId?: string | null;
  documentVersionId?: string | null;
  sourceType?: string | null;
  anchorId?: string | null;
  currentTruthSummary?: string | null;
}

interface MessageContextualRetrievalInput {
  bodyText: string;
  provider: string;
  threadSubject?: string | null;
  senderLabel: string;
  senderEmail?: string | null;
  sentAt: Date | string;
  projectId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  participants?: string[];
  attachmentNames?: string[];
  currentTruthSummary?: string | null;
}

function compactParts(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0));
}

export function buildDocumentContextualRetrievalText(input: DocumentContextualRetrievalInput) {
  const heading = input.headingPath && input.headingPath.length > 0 ? input.headingPath.join(" > ") : null;
  const prefix = compactParts([
    `Document: ${input.documentTitle}`,
    `Kind: ${input.kind}`,
    heading ? `Heading: ${heading}` : null,
    input.pageNumber ? `Page: ${input.pageNumber}` : null,
    input.sourceType ? `Source: ${input.sourceType}` : "Source: document_section",
    input.anchorId ? `Anchor: ${input.anchorId}` : null,
    input.projectId ? `Project: ${input.projectId}` : null,
    input.documentVersionId ? `Document version: ${input.documentVersionId}` : null,
    input.currentTruthSummary ? `Accepted truth context: ${input.currentTruthSummary}` : null
  ]).join(" / ");

  return `${prefix} - ${input.content}`;
}

export function buildMessageContextualRetrievalText(input: MessageContextualRetrievalInput) {
  const sentAt = input.sentAt instanceof Date ? input.sentAt.toISOString() : input.sentAt;
  const sender = `${input.senderLabel}${input.senderEmail ? ` <${input.senderEmail}>` : ""}`;
  const prefix = compactParts([
    `Provider: ${input.provider}`,
    `Thread subject: ${input.threadSubject ?? "untitled thread"}`,
    input.participants && input.participants.length > 0 ? `Participants: ${input.participants.join("; ")}` : null,
    `Sender: ${sender}`,
    `Sent at: ${sentAt}`,
    input.projectId ? `Project: ${input.projectId}` : null,
    input.threadId ? `Thread: ${input.threadId}` : null,
    input.messageId ? `Message: ${input.messageId}` : null,
    input.currentTruthSummary ? `Accepted truth context: ${input.currentTruthSummary}` : null,
    input.attachmentNames && input.attachmentNames.length > 0
      ? `Attachments: ${input.attachmentNames.join(", ")}`
      : null
  ]).join(" / ");

  return `${prefix} - ${input.bodyText}`;
}

export function buildMessageLexicalRetrievalText(input: {
  bodyText: string;
  senderLabel: string;
  senderEmail?: string | null;
  subject?: string | null;
  attachmentNames?: string[];
}) {
  return compactParts([
    input.subject ?? "",
    input.senderLabel,
    input.senderEmail ?? "",
    input.bodyText,
    ...(input.attachmentNames ?? [])
  ]).join(" ");
}
