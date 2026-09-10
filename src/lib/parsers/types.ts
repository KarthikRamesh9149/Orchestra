export interface ParsedSection {
  title: string;
  headingPath: string[];
  pageNumber: number | null;
  text: string;
  metadataJson?: Record<string, unknown>;
}

export interface ParsedDocument {
  text: string;
  sections: ParsedSection[];
}
