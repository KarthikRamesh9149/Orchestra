import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { safeMarkdownUrl } from "../../lib/socratesPresentation";
import { SocratesMarkdown } from "./SocratesMarkdown";

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
});
