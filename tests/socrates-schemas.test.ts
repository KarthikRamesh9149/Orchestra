/**
 * Tests the Zod schemas that validate Socrates input/output.
 * These are purely unit tests — no DB or LLM involved.
 */

import { describe, expect, it } from "vitest";
import {
  answerSchema,
  createSessionBodySchema,
  patchContextBodySchema,
  streamMessageBodySchema,
} from "../src/modules/socrates/schemas.js";

describe("createSessionBodySchema", () => {
  it("accepts a valid session creation body", () => {
    const body = {
      pageContext: "brain_graph",
      selectedRefType: "brain_node",
      selectedRefId: "11111111-1111-1111-1111-111111111111",
    };
    expect(() => createSessionBodySchema.parse(body)).not.toThrow();
  });

  it("accepts minimal body with only pageContext", () => {
    expect(() => createSessionBodySchema.parse({ pageContext: "doc_viewer" })).not.toThrow();
  });

  it("rejects unknown pageContext", () => {
    expect(() => createSessionBodySchema.parse({ pageContext: "unknown_page" })).toThrow();
  });

  it("accepts string selectedRefId values for non-UUID live doc sections", () => {
    expect(() =>
      createSessionBodySchema.parse({
        pageContext: "live_doc",
        selectedRefType: "live_doc_section",
        selectedRefId: "overview",
      })
    ).not.toThrow();
  });

  it("rejects bodies that provide selectedRefType without selectedRefId", () => {
    expect(() =>
      createSessionBodySchema.parse({
        pageContext: "brain_graph",
        selectedRefType: "brain_node",
      })
    ).toThrow();
  });
});

describe("patchContextBodySchema", () => {
  it("accepts null to clear selectedRef", () => {
    const body = { selectedRefType: null, selectedRefId: null };
    expect(() => patchContextBodySchema.parse(body)).not.toThrow();
  });

  it("accepts a pageContext update alone", () => {
    expect(() => patchContextBodySchema.parse({ pageContext: "dashboard_project" })).not.toThrow();
  });

  it("rejects partial selectedRef updates", () => {
    expect(() => patchContextBodySchema.parse({ selectedRefId: "11111111-1111-1111-1111-111111111111" })).toThrow();
  });
});

describe("streamMessageBodySchema", () => {
  it("accepts a normal message", () => {
    expect(() => streamMessageBodySchema.parse({ content: "What changed recently?" })).not.toThrow();
  });

  it("rejects empty content", () => {
    expect(() => streamMessageBodySchema.parse({ content: "" })).toThrow();
  });

  it("rejects content over 8000 chars", () => {
    expect(() => streamMessageBodySchema.parse({ content: "x".repeat(8001) })).toThrow();
  });
});

describe("answerSchema", () => {
  const validAnswer = {
    answer_md: "The feature was first introduced in the PRD.",
    citations: [
      {
        type: "product_brain",
        refId: "22222222-2222-2222-2222-222222222222",
        label: "Product Brain v3",
        confidence: 0.91,
      },
    ],
    open_targets: [
      {
        targetType: "document_section",
        targetRef: {
          anchorId: "feature_overview",
          documentVersionId: "33333333-3333-3333-3333-333333333333",
          pageNumber: 3,
        },
      },
    ],
    suggested_prompts: ["What changed in this section?"],
    suggested_actions: [],
    confidence: "high",
    limitations: [],
  };

  it("accepts a valid complete answer", () => {
    expect(() => answerSchema.parse(validAnswer)).not.toThrow();
  });

  it("accepts answer with empty citations and targets", () => {
    expect(() =>
      answerSchema.parse({
        answer_md: "I don't have enough evidence to answer that.",
        citations: [],
        open_targets: [],
        suggested_prompts: [],
        suggested_actions: [],
        confidence: "low",
        limitations: ["No directly matching evidence was found."],
      })
    ).not.toThrow();
  });

  it("accepts valid suggested actions and rejects invalid action payloads", () => {
    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        suggested_actions: [
          {
            type: "assign_task",
            label: "Assign backend auth to Ali",
            payload: {
              assigneeName: "Ali",
              taskTitle: "Build backend auth",
              taskDescription: "Implement login endpoints",
              area: "backend",
              status: "open"
            },
            confidence: "high",
            requiresConfirmation: true
          }
        ]
      })
    ).not.toThrow();

    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        suggested_actions: [
          {
            type: "create_context_note",
            label: "Unsafe note",
            payload: {
              type: "manual_note",
              title: "Token",
              body: "Do not store secrets",
              apiKey: "sk-test"
            },
            requiresConfirmation: true
          }
        ]
      })
    ).toThrow();
  });

  it("accepts project event open targets from Socrates calendar actions", () => {
    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        open_targets: [
          {
            targetType: "project_event",
            targetRef: {
              projectId: "11111111-1111-4111-8111-111111111111",
              eventId: "22222222-2222-4222-8222-222222222222"
            }
          }
        ]
      })
    ).not.toThrow();
  });

  it("rejects answer with empty answer_md", () => {
    expect(() => answerSchema.parse({ ...validAnswer, answer_md: "" })).toThrow();
  });

  it("rejects answer with invalid citation type", () => {
    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        citations: [
          { type: "unknown_type", refId: "22222222-2222-2222-2222-222222222222", label: "x" },
        ],
      })
    ).toThrow();
  });

  it("rejects numeric answer confidence", () => {
    expect(() => answerSchema.parse({ ...validAnswer, confidence: 0.9 })).toThrow();
  });

  it("rejects missing limitations", () => {
    const { limitations: _limitations, ...withoutLimitations } = validAnswer;
    expect(() => answerSchema.parse(withoutLimitations)).toThrow();
  });

  it("rejects unknown answer fields", () => {
    expect(() => answerSchema.parse({ ...validAnswer, unexpected: true })).toThrow();
  });

  it("rejects unknown citation fields", () => {
    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        citations: [
          {
            type: "product_brain",
            refId: "22222222-2222-2222-2222-222222222222",
            label: "Product Brain v3",
            providerPermalink: "https://provider.example/internal"
          }
        ]
      })
    ).toThrow();
  });

  it("rejects unknown open target fields", () => {
    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        open_targets: [
          {
            targetType: "document_section",
            targetRef: {
              anchorId: "feature_overview",
              documentVersionId: "33333333-3333-3333-3333-333333333333",
              internalRoute: "/v1/projects/internal/messages/msg-1"
            }
          }
        ]
      })
    ).toThrow();
  });

  it("rejects more than 5 suggested prompts", () => {
    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        suggested_prompts: ["a", "b", "c", "d", "e", "f"],
      })
    ).toThrow();
  });

  it("rejects oversized model-controlled prompt and limitation fields", () => {
    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        suggested_prompts: ["x".repeat(201)]
      })
    ).toThrow();

    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        limitations: Array.from({ length: 11 }, (_, index) => `limitation-${index}`)
      })
    ).toThrow();

    expect(() =>
      answerSchema.parse({
        ...validAnswer,
        limitations: ["x".repeat(501)]
      })
    ).toThrow();
  });
});
