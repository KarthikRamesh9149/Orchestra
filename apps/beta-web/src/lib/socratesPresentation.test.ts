import { describe, expect, it } from "vitest";
import { resolveOpenTarget, safeExternalUrl, safeMarkdownUrl, targetForCitation } from "./socratesPresentation";

describe("Socrates answer presentation", () => {
  it("allows only safe external and single-slash internal links", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeMarkdownUrl("/memory?doc=1")).toBe("/memory?doc=1");
    expect(safeMarkdownUrl("//attacker.example/path")).toBeNull();
  });

  it("resolves backend open targets without exposing raw identifiers", () => {
    expect(resolveOpenTarget({
      id: "target:1", sourceType: "document", targetType: "document_section",
      targetRef: { documentId: "doc/one", anchorId: "launch plan" },
    })).toEqual({ href: "/memory/docs/doc%2Fone/view?anchor=launch+plan", label: "Open document", external: false });
    expect(resolveOpenTarget({
      id: "target:brain", sourceType: "brain_node", targetType: "product_brain",
      targetRef: { brainNodeId: "node-1", artifactVersionId: "brain-v2" },
    })).toEqual({ href: "/dashboard?brainNode=node-1&brainVersion=brain-v2", label: "Open Product Brain", external: false });
    expect(resolveOpenTarget({
      id: "target:github", sourceType: "github", targetType: "github_evidence",
      targetRef: { repo: "orchestra/web", sourceUrl: "https://github.com/orchestra/web/pull/42" },
    })).toEqual({ href: "https://github.com/orchestra/web/pull/42", label: "Open GitHub evidence", external: true });
    expect(resolveOpenTarget({
      id: "target:unsafe", sourceType: "github", targetType: "github_evidence",
      targetRef: { repo: "orchestra/web", sourceUrl: "javascript:alert(1)" },
    })).toEqual({ href: "https://github.com/orchestra/web", label: "Open GitHub evidence", external: true });
  });

  it("binds citations to their explicit open target", () => {
    const targets = [{ id: "target:1", sourceType: "document", targetType: "document_section", targetRef: { documentId: "doc-1" } }];
    expect(targetForCitation({ refId: "doc:1", sourceType: "document", label: "Plan", excerpt: "", openTargetId: "target:1" }, targets)).toBe(targets[0]);
  });
});
