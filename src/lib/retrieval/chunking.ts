import { buildDocumentContextualRetrievalText } from "./contextualize.js";

export interface ChunkResult {
  chunkIndex: number;
  content: string;
  contextualContent: string;
  tokenCount: number;
}

export function estimateTokenCount(value: string) {
  return Math.ceil(value.split(/\s+/).filter(Boolean).length * 1.3);
}

export function chunkText(input: {
  content: string;
  documentTitle: string;
  kind: string;
  headingPath: string[];
  pageNumber: number | null;
  chunkSize?: number;
  overlapSize?: number;
}) {
  const chunkSize = input.chunkSize ?? 500;
  const overlapSize = input.overlapSize ?? 75;
  const tokens = input.content.split(/\s+/).filter(Boolean);
  const results: ChunkResult[] = [];

  for (let index = 0; index < tokens.length; index += Math.max(chunkSize - overlapSize, 1)) {
    const slice = tokens.slice(index, index + chunkSize);
    if (slice.length === 0) {
      continue;
    }

    const content = slice.join(" ");
    results.push({
      chunkIndex: results.length,
      content,
      contextualContent: buildDocumentContextualRetrievalText({
        content,
        documentTitle: input.documentTitle,
        kind: input.kind,
        headingPath: input.headingPath,
        pageNumber: input.pageNumber,
        sourceType: "document_chunk"
      }),
      tokenCount: estimateTokenCount(content)
    });

    if (index + chunkSize >= tokens.length) {
      break;
    }
  }

  return results;
}
