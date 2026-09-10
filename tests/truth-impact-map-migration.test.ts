import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260823200000_change_impact_map_indexes/migration.sql", import.meta.url),
  "utf8"
);

describe("Change Impact Map query indexes", () => {
  it("indexes every new persisted graph lookup without weakening table policy", () => {
    for (const index of [
      "brain_section_links_project_node_idx",
      "brain_section_links_project_section_idx",
      "live_doc_section_drafts_project_proposal_idx"
    ]) {
      expect(migration).toContain(`CREATE INDEX IF NOT EXISTS \"${index}\"`);
      expect(schema).toContain(`map: \"${index}\"`);
    }
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY|DROP POLICY|DROP TABLE/i);
  });
});
