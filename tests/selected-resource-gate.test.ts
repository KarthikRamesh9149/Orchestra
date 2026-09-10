import { describe, expect, it } from "vitest";
import { evaluateSelectedResourceAccess } from "../src/lib/communications/selected-resource-gate.js";

describe("selected-resource gate", () => {
  it("denies events when the connector has no selected resources", () => {
    expect(
      evaluateSelectedResourceAccess({
        selected: [],
        candidates: [{ type: "channel", id: "C123" }],
        fallbackScope: { type: "channel", id: "C123" }
      })
    ).toMatchObject({ allowed: false, reason: "no_selected_resources" });
  });

  it("allows an event that names an explicitly selected resource", () => {
    expect(
      evaluateSelectedResourceAccess({
        selected: [{ type: "channel", id: "C123" }],
        candidates: [{ type: "channel", id: "C123" }]
      })
    ).toMatchObject({ allowed: true, matched: { type: "channel", id: "C123" } });
  });

  it("denies an event that names an unselected resource", () => {
    expect(
      evaluateSelectedResourceAccess({
        selected: [{ type: "channel", id: "C123" }],
        candidates: [{ type: "channel", id: "C999" }]
      })
    ).toMatchObject({ allowed: false, reason: "resource_not_selected" });
  });

  it("allows a provider webhook scope only when the stored scope is explicitly selected", () => {
    expect(
      evaluateSelectedResourceAccess({
        selected: [{ type: "list", id: "list-1" }],
        candidates: [],
        fallbackScope: { type: "list", id: "list-1" }
      })
    ).toMatchObject({ allowed: true, matched: { type: "list", id: "list-1" } });
  });

  it("denies provider webhook scopes that are not part of the selected resource set", () => {
    expect(
      evaluateSelectedResourceAccess({
        selected: [{ type: "list", id: "list-1" }],
        candidates: [],
        fallbackScope: { type: "list", id: "list-999" }
      })
    ).toMatchObject({ allowed: false, reason: "resource_not_selected" });
  });
});
