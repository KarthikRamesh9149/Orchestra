import { describe, expect, it } from "vitest";
import {
  communicationImportBodySchema,
  communicationProviderSchema,
  manualImportBodySchema,
  messageInsightListQuerySchema,
  timelineQuerySchema
} from "../src/modules/communications/schemas.js";

describe("communication layer schemas", () => {
  it("accepts ClickUp as a communication provider enum value", () => {
    expect(communicationProviderSchema.parse("slack")).toBe("slack");
    expect(communicationProviderSchema.parse("clickup")).toBe("clickup");
  });

  it("accepts the C1 manual import payload shape", () => {
    const parsed = manualImportBodySchema.parse({
      provider: "manual_import",
      accountLabel: "Demo import",
      thread: {
        providerThreadId: "thread-reporting-001",
        subject: "Reporting requirement discussion",
        participants: [{ label: "Client", externalRef: "client@example.com" }]
      },
      messages: [
        {
          providerMessageId: "msg-001",
          senderLabel: "Client",
          sentAt: "2026-04-19T10:01:00.000Z",
          bodyText: "Can we add weekly reporting for managers?",
          messageType: "user",
          attachments: []
        }
      ]
    });

    expect(parsed.thread.providerThreadId).toBe("thread-reporting-001");
    expect(parsed.messages).toHaveLength(1);
  });

  it("sanitizes active manual import HTML and rejects unsafe provider URLs", () => {
    const sanitized = manualImportBodySchema.parse({
      provider: "manual_import",
      accountLabel: "Demo import",
      thread: {
        providerThreadId: "thread-reporting-001",
        subject: "Reporting requirement discussion",
        participants: [{ label: "Client" }],
        threadUrl: "https://provider.example/thread/1"
      },
      messages: [
        {
          providerMessageId: "msg-001",
          senderLabel: "Client",
          sentAt: "2026-04-19T10:01:00.000Z",
          bodyText: "Can we add weekly reporting for managers?",
          bodyHtml: "<p>Can we add weekly reporting?</p><script>alert(1)</script><img src=x onerror=alert(1)>",
          messageType: "user",
          providerPermalink: "https://provider.example/message/1",
          attachments: [{ filename: "brief.pdf", providerUrl: "https://provider.example/file/1" }]
        }
      ]
    });

    expect(sanitized.messages[0].bodyHtml).toBe("<p>Can we add weekly reporting?</p>");

    for (const unsafeUrl of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "http://localhost:3000/internal",
      "http://127.0.0.1/internal",
      "http://10.0.0.5/internal"
    ]) {
      expect(
        manualImportBodySchema.safeParse({
          provider: "manual_import",
          thread: {
            providerThreadId: "thread-reporting-001",
            participants: [],
            threadUrl: unsafeUrl
          },
          messages: [
            {
              providerMessageId: "msg-001",
              senderLabel: "Client",
              sentAt: "2026-04-19T10:01:00.000Z",
              bodyText: "Weekly reporting",
              messageType: "user",
              providerPermalink: unsafeUrl,
              attachments: [{ filename: "brief.pdf", providerUrl: unsafeUrl }]
            }
          ]
        }).success
      ).toBe(false);
    }
  });

  it("parses timeline filters and cursor pagination inputs", () => {
    const parsed = timelineQuerySchema.parse({
      provider: "manual_import",
      connectorId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
      sourceSubType: "slack_thread_reply",
      insightStatus: "detected",
      proposalStatus: "needs_review",
      hasChangeProposal: "true",
      search: "reporting",
      limit: "10"
    });

    expect(parsed.provider).toBe("manual_import");
    expect(parsed.connectorId).toBe("3322717f-2c10-4239-b525-6fbc9158f4fb");
    expect(parsed.sourceSubType).toBe("slack_thread_reply");
    expect(parsed.insightStatus).toBe("detected");
    expect(parsed.proposalStatus).toBe("needs_review");
    expect(parsed.hasChangeProposal).toBe(true);
    expect(parsed.limit).toBe(10);
  });

  it("accepts Fireflies transcript import payloads through the shared import schema", () => {
    const parsed = communicationImportBodySchema.parse({
      provider: "fireflies_ai",
      accountLabel: "Fireflies",
      meeting: {
        providerTranscriptId: "ff-transcript-1",
        title: "Client Kickoff",
        startedAt: "2026-05-12T10:00:00.000Z",
        participants: [{ name: "Sarah Client", email: "sarah@example.com", role: "client" }],
        sourceUrl: "https://app.fireflies.ai/view/ff-transcript-1"
      },
      summary: "AI-generated summary, not truth.",
      actionItems: ["Follow up on reporting cadence"],
      segments: [
        {
          speakerName: "Sarah Client",
          speakerEmail: "sarah@example.com",
          startMs: 724000,
          endMs: 741000,
          text: "Let's change reporting from monthly to weekly."
        }
      ]
    });

    expect(parsed.provider).toBe("fireflies_ai");
    if (parsed.provider !== "fireflies_ai") throw new Error("expected fireflies import payload");
    expect(parsed.segments[0].startMs).toBe(724000);
  });

  it("parses message insight review filters", () => {
    const parsed = messageInsightListQuerySchema.parse({
      status: "detected",
      insightType: "requirement_change",
      hasProposal: "false",
      minConfidence: "0.8",
      limit: "20"
    });

    expect(parsed.status).toBe("detected");
    expect(parsed.insightType).toBe("requirement_change");
    expect(parsed.hasProposal).toBe(false);
    expect(parsed.minConfidence).toBe(0.8);
    expect(parsed.limit).toBe(20);
  });
});
