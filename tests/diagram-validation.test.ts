import { describe, expect, it } from "vitest";
import { validateMermaidSource } from "../src/modules/diagrams/mermaid-validation.js";

describe("Mermaid validation", () => {
  it("accepts safe flowchart and sequence sources", () => {
    expect(
      validateMermaidSource({
        diagramType: "flowchart",
        mermaidSource: "flowchart TD\n  A[Start] --> B[Done]"
      })
    ).toContain("flowchart TD");
    expect(
      validateMermaidSource({
        diagramType: "sequence",
        mermaidSource: "sequenceDiagram\n  participant User\n  User->>API: Request"
      })
    ).toContain("sequenceDiagram");
  });

  it("rejects empty, too long, unsafe, and type-mismatched sources", () => {
    expect(() => validateMermaidSource({ diagramType: "flowchart", mermaidSource: "   " })).toThrow(
      /required/
    );
    expect(() =>
      validateMermaidSource({ diagramType: "flowchart", mermaidSource: `flowchart TD\n${"A".repeat(20_001)}` })
    ).toThrow(/maximum length/);
    expect(() =>
      validateMermaidSource({ diagramType: "flowchart", mermaidSource: "flowchart TD\n  A[<script>alert(1)</script>]" })
    ).toThrow(/unsafe/);
    expect(() =>
      validateMermaidSource({ diagramType: "flowchart", mermaidSource: "flowchart TD\n  A --> B\n  click A javascript:alert(1)" })
    ).toThrow(/unsafe/);
    expect(() =>
      validateMermaidSource({ diagramType: "flowchart", mermaidSource: "%%{init: {}}\nflowchart TD\n  A --> B" })
    ).toThrow(/unsafe/);
    expect(() =>
      validateMermaidSource({ diagramType: "sequence", mermaidSource: "flowchart TD\n  A --> B" })
    ).toThrow(/Sequence diagrams/);
  });

  it("rejects active-content and unsafe protocol vectors", () => {
    const unsafeSources = [
      "flowchart TD\n  A[<iframe src='https://example.com'></iframe>]",
      "flowchart TD\n  A[<object data='x'></object>]",
      "flowchart TD\n  A[<embed src='x'>]",
      "flowchart TD\n  A[<img src=x onerror=alert(1)>]",
      "flowchart TD\n  A[<svg><foreignObject>bad</foreignObject></svg>]",
      "flowchart TD\n  A[data:text/html,alert(1)]",
      "flowchart TD\n  A[vbscript:msgbox(1)]",
      "flowchart TD\n  A[Label onload=alert(1)]",
      "flowchart TD\n  A[Label onclick=alert(1)]",
      "flowchart TD\n  A[Label style=color:red]",
      "flowchart TD\n  A[Label href=https://example.com]",
      "flowchart TD\n  A --> B\n  click A href \"https://example.com\"",
      "flowchart TD\n  A --> B\n  click A callback \"Tooltip\"",
      "%%{config: { securityLevel: 'loose' }}%%\nflowchart TD\n  A --> B"
    ];

    for (const mermaidSource of unsafeSources) {
      expect(() => validateMermaidSource({ diagramType: "flowchart", mermaidSource })).toThrow(/unsafe/);
    }
  });
});
