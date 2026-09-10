import { describe, expect, it } from "vitest";
import { parseTextDocument } from "../src/lib/parsers/text.js";
import { chunkText, estimateTokenCount } from "../src/lib/retrieval/chunking.js";
import { toAnchorId } from "../src/lib/utils/anchors.js";

describe("document parsing and chunking", () => {
  it("creates structured markdown sections", () => {
    const parsed = parseTextDocument(`# Overview\nProduct intro\n## Flows\nMain flow details`);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]?.headingPath).toEqual(["Overview"]);
    expect(parsed.sections[1]?.headingPath).toEqual(["Overview", "Flows"]);
  });

  it("creates contextual chunk text with metadata", () => {
    const chunks = chunkText({
      content: "one two three four five six seven eight nine ten eleven twelve",
      documentTitle: "Core PRD",
      kind: "prd",
      headingPath: ["Overview", "Flows"],
      pageNumber: 6,
      chunkSize: 5,
      overlapSize: 1
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.contextualContent).toContain("Core PRD");
    expect(chunks[0]?.contextualContent).toContain("Overview > Flows");
    expect(chunks[0]?.tokenCount).toBe(estimateTokenCount(chunks[0]!.content));
  });

  it("creates stable anchor ids", () => {
    expect(toAnchorId("Reporting Requirements", 0)).toBe("reporting-requirements-1");
  });

  it("bounds markdown heading fan-out while preserving the source text", () => {
    const content = Array.from({ length: 2_000 }, (_, index) => `# Heading ${index}\nBody ${index}`).join("\n");
    const parsed = parseTextDocument(content);
    expect(parsed.text).toBe(content);
    expect(parsed.sections.length).toBeLessThanOrEqual(500);
    expect(parsed.sections.at(-1)?.text).toContain("Heading 1999");
  });
});
