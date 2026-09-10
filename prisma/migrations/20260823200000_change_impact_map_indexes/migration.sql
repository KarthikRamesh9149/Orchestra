-- Feature 3 reads persisted graph relationships by project and source anchor.
-- These indexes keep the Change Impact Map bounded as a workspace grows.
CREATE INDEX IF NOT EXISTS "brain_section_links_project_node_idx"
  ON "brain_section_links" ("project_id", "brain_node_id");

CREATE INDEX IF NOT EXISTS "brain_section_links_project_section_idx"
  ON "brain_section_links" ("project_id", "document_section_id");

CREATE INDEX IF NOT EXISTS "live_doc_section_drafts_project_proposal_idx"
  ON "live_doc_section_drafts" ("project_id", "linked_proposal_id");
