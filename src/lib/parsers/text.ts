import type { ParsedDocument, ParsedSection } from "./types.js";
import { assertParsedTextSafe, MAX_PARSED_SECTIONS } from "./file-safety.js";

const MAX_HEADING_CHARS = 200;

function splitMarkdownSections(content: string): ParsedSection[] {
  const lines = content.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let currentTitle = "Introduction";
  let currentHeadingPath = [currentTitle];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (!text) {
      return;
    }

    sections.push({
      title: currentTitle,
      headingPath: currentHeadingPath,
      pageNumber: null,
      text
    });
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      if (sections.length >= MAX_PARSED_SECTIONS - 1) {
        buffer.push(line);
        continue;
      }
      flush();
      const level = headingMatch[1].length;
      currentTitle = headingMatch[2].trim().slice(0, MAX_HEADING_CHARS) || "Untitled section";
      currentHeadingPath = [...currentHeadingPath.slice(0, Math.max(level - 1, 0)), currentTitle];
      continue;
    }

    buffer.push(line);
  }

  flush();

  if (sections.length === 0) {
    sections.push({
      title: "Document",
      headingPath: ["Document"],
      pageNumber: null,
      text: content.trim()
    });
  }

  return sections;
}

export function parseTextDocument(content: string): ParsedDocument {
  assertParsedTextSafe(content);
  return {
    text: content,
    sections: splitMarkdownSections(content)
  };
}
