import mammoth from "mammoth";
import { parseTextDocument } from "./text.js";
import { assertDocxZipContentSafe, assertParsedTextSafe, withParserTimeout } from "./file-safety.js";

export async function parseDocxDocument(buffer: Buffer) {
  await assertDocxZipContentSafe(buffer);
  const result = await withParserTimeout(mammoth.extractRawText({ buffer }), "DOCX parsing");
  assertParsedTextSafe(result.value);
  return parseTextDocument(result.value);
}
