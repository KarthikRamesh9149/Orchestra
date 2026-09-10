import { describe, expect, it } from "vitest";
import { assertDocumentBufferSafe } from "../src/lib/parsers/file-safety.js";

describe("parser file safety", () => {
  it("does not treat a document title without an extension as a filename mismatch", () => {
    expect(() => {
      assertDocumentBufferSafe("application/pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "Helios Beta PRD");
    }).not.toThrow();
  });

  it("still rejects explicit PDF filename mismatches", () => {
    expect(() => {
      assertDocumentBufferSafe("application/pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "helios-beta-prd.txt");
    }).toThrow(/filename extension/i);
  });
});
