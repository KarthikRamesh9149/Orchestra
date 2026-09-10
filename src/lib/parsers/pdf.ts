import { PDFParse } from "pdf-parse";
import { parseTextDocument } from "./text.js";
import { assertParsedTextSafe, MAX_PDF_PAGES, withParserTimeout } from "./file-safety.js";
import { AppError } from "../../app/errors.js";

export async function parsePdfDocument(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await withParserTimeout<{ total: number }>(
      parser.getInfo() as Promise<{ total: number }>,
      "PDF inspection"
    );
    if (info.total > MAX_PDF_PAGES) {
      throw new AppError(413, "PDF exceeds page safety limits", "document_pdf_page_limit_exceeded");
    }

    const result = await withParserTimeout<{ text: string }>(
      parser.getText() as Promise<{ text: string }>,
      "PDF parsing"
    );
    assertParsedTextSafe(result.text);
    return parseTextDocument(result.text);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(422, "PDF could not be parsed. Upload a valid exported PDF file.", "document_pdf_parse_failed");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
