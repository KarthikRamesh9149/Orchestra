import { describe, expect, it } from "vitest";
import {
  buildDocumentContextualRetrievalText,
  buildMessageContextualRetrievalText,
  buildMessageLexicalRetrievalText
} from "../src/lib/retrieval/contextualize.js";
import { chunkText } from "../src/lib/retrieval/chunking.js";

describe("retrieval contextualization", () => {
  it("builds document contextual retrieval text without changing raw chunk content", () => {
    const chunks = chunkText({
      content: "Reporting should be weekly for managers.",
      documentTitle: "Admin PRD",
      kind: "prd",
      headingPath: ["Requirements", "Reporting"],
      pageNumber: 6,
      chunkSize: 20,
      overlapSize: 0
    });

    expect(chunks[0].content).toBe("Reporting should be weekly for managers.");
    expect(chunks[0].contextualContent).toContain("Document: Admin PRD");
    expect(chunks[0].contextualContent).toContain("Kind: prd");
    expect(chunks[0].contextualContent).toContain("Heading: Requirements > Reporting");
    expect(chunks[0].contextualContent).toContain("Page: 6");
  });

  it("builds direct document context with source and anchor metadata", () => {
    const text = buildDocumentContextualRetrievalText({
      content: "Approval is manager-only.",
      documentTitle: "Security Spec",
      kind: "spec",
      headingPath: ["Auth", "Roles"],
      pageNumber: 3,
      documentVersionId: "dv_1",
      anchorId: "roles",
      sourceType: "document_section"
    });

    expect(text).toContain("Source: document_section");
    expect(text).toContain("Anchor: roles");
    expect(text).toContain("Document version: dv_1");
  });

  it("builds message contextual and lexical retrieval text", () => {
    const contextual = buildMessageContextualRetrievalText({
      bodyText: "Can we add weekly reporting?",
      provider: "slack",
      threadSubject: "Reporting requirement",
      senderLabel: "Client",
      senderEmail: "client@example.com",
      sentAt: new Date("2026-04-19T10:00:00.000Z"),
      projectId: "proj_1",
      messageId: "msg_1",
      threadId: "thr_1"
    });
    const lexical = buildMessageLexicalRetrievalText({
      bodyText: "Can we add weekly reporting?",
      senderLabel: "Client",
      senderEmail: "client@example.com",
      subject: "Reporting requirement"
    });

    expect(contextual).toContain("Provider: slack");
    expect(contextual).toContain("Thread subject: Reporting requirement");
    expect(contextual).toContain("Sender: Client <client@example.com>");
    expect(contextual).toContain("Sent at: 2026-04-19T10:00:00.000Z");
    expect(lexical).toContain("Reporting requirement");
    expect(lexical).toContain("Can we add weekly reporting?");
  });
});
