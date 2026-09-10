import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  betaMultipartUploadMetadataSchema,
  multipartUploadMetadataSchema,
  pastedTextUploadSchema
} from "../src/modules/documents/schemas.js";
import {
  clientDocumentParamsSchema,
  clientDocumentSearchQuerySchema,
  clientShareTokenParamSchema,
  createClientShareBodySchema
} from "../src/modules/client-view/client-view.schemas.js";
import {
  communicationImportBodySchema,
  connectorPatchBodySchema,
  firefliesTranscriptSegmentSchema,
  webhookChallengeQuerySchema
} from "../src/modules/communications/schemas.js";
import { openTargetRefSchema } from "../src/modules/socrates/schemas.js";
import { verifyFirefliesSignature } from "../src/modules/communications/providers/fireflies.provider.js";
import { parseDocumentBuffer } from "../src/lib/parsers/index.js";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as new (options?: Record<string, unknown>) => {
  on: (event: string, callback: (...args: any[]) => void) => void;
  fontSize: (size: number) => { text: (text: string, options?: Record<string, unknown>) => void };
  text: (text: string, options?: Record<string, unknown>) => void;
  moveDown: () => void;
  end: () => void;
};

describe("P2 negative payload and path schema hardening", () => {
  it("rejects malformed public client-token paths before lookup", () => {
    for (const token of ["", "client-token", "cs_short", `cs_${"a".repeat(42)}`, `cs_${"a".repeat(44)}`, `cs_${"!".repeat(43)}`]) {
      expect(clientShareTokenParamSchema.safeParse(token).success).toBe(false);
    }

    expect(clientDocumentParamsSchema.safeParse({ token: `cs_${"a".repeat(43)}`, documentId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects unsafe public/client payload schema shapes", () => {
    expect(createClientShareBodySchema.safeParse({ name: "", config: { allowedDocumentIds: ["not-a-uuid"] } }).success).toBe(false);
    expect(createClientShareBodySchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    expect(clientDocumentSearchQuerySchema.safeParse({ q: "", limit: 10 }).success).toBe(false);
    expect(clientDocumentSearchQuerySchema.safeParse({ q: "reporting", limit: 1000 }).success).toBe(false);
  });

  it("rejects malformed file upload metadata and pasted text payloads", () => {
    for (const payload of [
      { title: "x", kind: "prd" },
      { title: "Valid", kind: "unknown" },
      { title: "Valid", visibility: "public" },
      { title: "Valid", sourceLabel: "" }
    ]) {
      expect(multipartUploadMetadataSchema.safeParse(payload).success).toBe(false);
    }

    expect(pastedTextUploadSchema.safeParse({ kind: "prd", title: "Valid", pastedText: "" }).success).toBe(false);
    expect(pastedTextUploadSchema.safeParse({ kind: "malware", title: "Valid", pastedText: "content" }).success).toBe(false);
  });

  it("normalizes unknown beta upload kind metadata without weakening strict upload validation", () => {
    expect(multipartUploadMetadataSchema.safeParse({ title: "RentL Dev Requirements", kind: "requirements" }).success).toBe(
      false
    );

    const parsed = betaMultipartUploadMetadataSchema.parse({ title: "RentL Dev Requirements", kind: "requirements" });
    expect(parsed.kind).toBe("reference");
  });

  it("fails closed for unsupported parser MIME types instead of treating binary as text", async () => {
    await expect(
      parseDocumentBuffer("application/x-msdownload", Buffer.from([0x4d, 0x5a, 0x00, 0x01]), "payload.exe")
    ).rejects.toMatchObject({
      code: "unsupported_document_file_type"
    });
  });

  it("returns a typed upload error for malformed PDFs instead of an internal parser failure", async () => {
    await expect(
      parseDocumentBuffer("application/pdf", Buffer.from("%PDF-1.4\nthis is not a complete pdf\n%%EOF\n"), "demo-prd.pdf")
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "document_pdf_parse_failed"
    });
  });

  it("accepts generated demo PDFs that are valid parser fixtures", async () => {
    const buffer = await createGeneratedPdfBuffer("Orchestra QA PRD\n\nThis fixture is a real PDF generated for upload QA.");
    const parsed = await parseDocumentBuffer("application/pdf", buffer, "demo-prd.pdf");

    expect(parsed.text).toContain("Orchestra QA PRD");
    expect(parsed.sections.length).toBeGreaterThan(0);
  });

  it("rejects malformed webhook and connector payloads", () => {
    expect(webhookChallengeQuerySchema.safeParse({ validationToken: ["array-is-invalid"] }).success).toBe(false);
    expect(connectorPatchBodySchema.safeParse({ accountLabel: "", config: {} }).success).toBe(false);
    expect(connectorPatchBodySchema.safeParse({ accountLabel: "x".repeat(201) }).success).toBe(false);

    const rawBody = JSON.stringify({ event: "meeting.transcribed", meeting_id: "ff-1" });
    expect(verifyFirefliesSignature(rawBody, "sha256=bad", "fireflies-webhook-secret")).toBe(false);
  });

  it("rejects malformed Fireflies transcript import segments", () => {
    expect(firefliesTranscriptSegmentSchema.safeParse({ startMs: 10, endMs: 9, text: "invalid range" }).success).toBe(false);
    expect(firefliesTranscriptSegmentSchema.safeParse({ startMs: -1, text: "negative start" }).success).toBe(false);
    expect(firefliesTranscriptSegmentSchema.safeParse({ startMs: 0, text: "" }).success).toBe(false);

    expect(
      communicationImportBodySchema.safeParse({
        provider: "fireflies_ai",
        meeting: {
          providerTranscriptId: "ff-1",
          title: "Client Call",
          startedAt: "not-a-date"
        },
        segments: [{ startMs: 0, text: "ok" }]
      }).success
    ).toBe(false);
  });

  it("rejects invalid Socrates open-target shapes before validation", () => {
    for (const target of [
      { targetType: "message", targetRef: { messageId: "not-a-uuid" } },
      { targetType: "message", targetRef: { messageId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90", secret: "extra" } },
      { targetType: "change_proposal", targetRef: { proposalId: "not-a-uuid" } },
      { targetType: "unknown", targetRef: {} },
      { targetType: "dashboard_filter", targetRef: { filter: 123 } }
    ]) {
      expect(openTargetRefSchema.safeParse(target).success).toBe(false);
    }
  });
});

async function createGeneratedPdfBuffer(text: string) {
  const document = new PDFDocument({
    size: "LETTER",
    margin: 56,
    compress: false,
    info: { Title: "Parser QA PRD", Creator: "Orchestra parser test" }
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.fontSize(18).text(text, { lineGap: 4 });
  document.end();
  return done;
}
