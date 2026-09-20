import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SocratesService } from "../src/modules/socrates/service.js";

describe("document chunk stored search vector", () => {
  it("adds an automatically maintained vector with unchanged English tokenisation and keeps existing indexes", () => {
    const sql = readFileSync(new URL("../prisma/migrations/20260920120000_document_chunk_search_vector/migration.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/ADD COLUMN\s+"?lexical_search_vector"?\s+tsvector/i);
    expect(sql).toMatch(/GENERATED ALWAYS AS\s*\(to_tsvector\('english'::regconfig,\s*"?lexical_content"?\)\)\s+STORED/i);
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|CREATE INDEX|enable_seqscan|enable_indexscan|enable_bitmapscan)\b/i);
    expect(readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")).toMatch(/lexicalSearchVector\s+Unsupported\("tsvector"\)\?[^\n]*@map\("lexical_search_vector"\)/);
  });

  it("uses stored ranking vectors without weakening parameterised full-corpus/current-source constraints", async () => {
    const instance = Object.create(SocratesService.prototype) as any;
    const queryRaw = vi.fn(async (_query: unknown) => [{ id: "matched-chunk" }]);
    instance.prisma = { $queryRaw: queryRaw };
    const projectId = "10000000-0000-4000-8000-000000000001";
    const documentId = "20000000-0000-4000-8000-000000000001";
    expect(await instance.findSocratesV1DocumentEvidenceIds(projectId, "Compare older routing records", [documentId])).toEqual(["matched-chunk"]);
    const query = queryRaw.mock.calls[0]![0] as any;
    const sql = query.sql as string;
    expect(sql).toContain("ts_rank_cd(dc.lexical_search_vector");
    expect(sql).toContain("dc.lexical_search_vector @@ websearch_to_tsquery");
    expect(sql).not.toContain("to_tsvector");
    expect(sql).toContain("dc.project_id = ?::uuid");
    expect(sql).toContain("d.current_version_id = dv.id");
    expect(sql).toContain("d.archived_at IS NULL");
    expect(sql).toContain("dc.parse_revision = dv.parse_revision");
    expect(sql).toContain("dv.status::text IN ('ready', 'partial')");
    expect(sql).toContain("AND d.id IN (?::uuid)");
    expect(sql).toContain("LIMIT 48");
    expect(query.values).toContain(projectId);
    expect(query.values).toContain(documentId);
    expect(sql).not.toContain(projectId);
    expect(sql).not.toMatch(/SET\s+enable_/i);
  });
});
