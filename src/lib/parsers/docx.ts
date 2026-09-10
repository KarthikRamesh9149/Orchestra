import mammoth from "mammoth";
import { parseTextDocument } from "./text.js";
import { assertDocxZipStructureSafe, assertParsedTextSafe, withParserTimeout } from "./file-safety.js";

export async function parseDocxDocument(buffer: Buffer) {
  assertDocxZipStructureSafe(buffer);
  const result = await withParserTimeout(mammoth.extractRawText({ buffer }), "DOCX parsing");
  assertParsedTextSafe(result.value);
  return parseTextDocument(result.value);
}
