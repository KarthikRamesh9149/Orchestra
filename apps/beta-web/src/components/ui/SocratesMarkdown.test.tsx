import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { safeMarkdownUrl } from "../../lib/socratesPresentation";
import { SocratesMarkdown } from "./SocratesMarkdown";
import type { Citation, OpenTarget } from "../../store/chatStore";

const citation = (evidenceNumber: number, openTargetId = `target:${evidenceNumber}`) => ({
  evidenceNumber, openTargetId, label: `Source ${evidenceNumber}`, excerpt: "Evidence", refId: `chunk:${evidenceNumber}`, sourceType: "document",
});
const target = (number: number): OpenTarget => ({
  id: `target:${number}`, sourceType: "document", targetType: "document_section", targetRef: { documentId: `doc-${number}` },
});

describe("SocratesMarkdown", () => {
  it("renders useful Markdown while removing HTML, images and unsafe links", () => {
    const { container } = render(<MemoryRouter><SocratesMarkdown content={'# Decision\n\n**Ship** Friday. [Docs](/memory) [Bad](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![tracker](https://example.com/tracker.png)'} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Decision" })).toBeVisible();
    expect(screen.getByText("Ship", { selector: "strong" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/memory");
    expect(screen.queryByRole("link", { name: "Bad" })).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
  });

  it("rejects ambiguous same-origin paths before the router can normalize them externally", () => {
    expect(safeMarkdownUrl("/\\\\attacker.example/path")).toBeNull();
    expect(safeMarkdownUrl("/%5c%5cattacker.example/path")).toBeNull();
    expect(safeMarkdownUrl("/%2f%2fattacker.example/path")).toBeNull();
    expect(safeMarkdownUrl("/memory?thread=123")).toBe("/memory?thread=123");
  });

  it("links sparse, out-of-order evidence markers by their preserved number, never card order", () => {
    render(<MemoryRouter><SocratesMarkdown content="Eight [E8], one **[E1]**, two [E2], unknown [E3]."
      citations={[citation(2), citation(8), citation(1)]} openTargets={[target(1), target(2), target(8)]} /></MemoryRouter>);
    for (const number of [8, 1, 2]) {
      expect(screen.getByRole("link", { name: `[E${number}]` })).toHaveAttribute("href", `/memory/docs/doc-${number}/view`);
    }
    expect(screen.queryByRole("link", { name: "[E3]" })).not.toBeInTheDocument();
    expect(screen.getByText(/unknown \[E3\]/)).toBeVisible();
  });

  it("leaves legacy, ambiguous and invalid evidence identities unlinked", () => {
    const { evidenceNumber: _number, ...legacy } = citation(1);
    const sources: Citation[] = [legacy, citation(2), citation(2), citation(3, "missing"), citation(4), citation(11)];
    render(<MemoryRouter><SocratesMarkdown content="[E1] [E2] [E3] [E4] [E11]"
      citations={sources} openTargets={[target(1), target(2), target(4), target(4), target(11)]} /></MemoryRouter>);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("[E1] [E2] [E3] [E4] [E11]")).toBeVisible();
  });

  it("keeps streaming markers plain until authoritative citation metadata arrives", () => {
    const view = render(<MemoryRouter><SocratesMarkdown content="Supported claim [E8]." streaming /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "[E8]" })).not.toBeInTheDocument();
    view.rerender(<MemoryRouter><SocratesMarkdown content="Supported claim [E8]." citations={[citation(8)]} openTargets={[target(8)]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "[E8]" })).toHaveAttribute("href", "/memory/docs/doc-8/view");
  });

  it("resolves lowercase evidence markers accepted by the backend without changing their text", () => {
    render(<MemoryRouter><SocratesMarkdown content="Mixed marker [e8] and [E02]." citations={[citation(2), citation(8)]} openTargets={[target(2), target(8)]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "[e8]" })).toHaveAttribute("href", "/memory/docs/doc-8/view");
    expect(screen.getByRole("link", { name: "[E02]" })).toHaveAttribute("href", "/memory/docs/doc-2/view");
  });

  it("does not rewrite code or existing links and sanitizes target URLs", () => {
    const { container } = render(<MemoryRouter><SocratesMarkdown content={'Literal `[E1]`. [Existing [E1]](https://example.com/docs)\n\n```text\n[E1]\n```\n\nProvider [E8]. Unsafe [E2].'}
      citations={[citation(1), citation(8), citation(2)]} openTargets={[
        target(1),
        { id: "target:8", targetType: "github_evidence", targetRef: { sourceUrl: "https://github.com/example/repo/pull/8" } },
        { id: "target:2", targetType: "github_evidence", targetRef: { sourceUrl: "javascript:alert(1)" } },
      ]} /></MemoryRouter>);
    expect(container.querySelectorAll("code a")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Existing [E1]" })).toHaveAttribute("href", "https://example.com/docs");
    expect(screen.getByRole("link", { name: "[E8]" })).toHaveAttribute("href", "https://github.com/example/repo/pull/8");
    expect(screen.getByRole("link", { name: "[E8]" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "[E2]" })).not.toBeInTheDocument();
    expect(container.querySelector("a a")).toBeNull();
  });
});
