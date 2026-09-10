import { describe, expect, it } from "vitest";
import { selectDomains } from "../src/lib/retrieval/domains.js";

describe("selectDomains", () => {
  it("dashboard_general enables dashboard + brain + changes but not documents", () => {
    const domains = selectDomains("dashboard_general", "dashboard_status");
    expect(domains.includeDashboard).toBe(true);
    expect(domains.includeBrainNodes).toBe(true);
    expect(domains.includeProductBrain).toBe(false);
    expect(domains.includeDocuments).toBe(false);
  });

  it("doc_viewer enables documents + communications + brain nodes", () => {
    const domains = selectDomains("doc_viewer", "doc_local");
    expect(domains.includeDocuments).toBe(true);
    expect(domains.includeCommunications).toBe(true);
    expect(domains.includeBrainNodes).toBe(true);
  });

  it("client_view never enables changes or communications by base rule", () => {
    const domains = selectDomains("client_view", "current_truth");
    expect(domains.includeChanges).toBe(false);
    expect(domains.includeCommunications).toBe(false);
    expect(domains.includeDocuments).toBe(true);
  });

  it("client_view never enables internal dashboard snapshots even for dashboard intent", () => {
    const domains = selectDomains("client_view", "dashboard_status");
    expect(domains.includeDashboard).toBe(false);
    expect(domains.includeChanges).toBe(false);
    expect(domains.includeDecisions).toBe(false);
    expect(domains.includeCommunications).toBe(false);
  });

  it("brain_graph enables brain nodes + documents + changes", () => {
    const domains = selectDomains("brain_graph", "brain_local");
    expect(domains.includeBrainNodes).toBe(true);
    expect(domains.includeDocuments).toBe(true);
    expect(domains.includeChanges).toBe(true);
  });

  it("current_truth intent enables brain nodes + changes + decisions on top of base", () => {
    const domains = selectDomains("doc_viewer", "current_truth");
    expect(domains.includeProductBrain).toBe(true);
    expect(domains.includeBrainNodes).toBe(true);
    expect(domains.includeChanges).toBe(true);
    expect(domains.includeDecisions).toBe(true);
  });

  it("communication_lookup intent enables communications even on dashboard", () => {
    const domains = selectDomains("dashboard_project", "communication_lookup");
    expect(domains.includeCommunications).toBe(true);
  });

  it("team responsibility intent enables responsibility context for internal users", () => {
    const domains = selectDomains("dashboard_project", "team_responsibility");
    expect(domains.includeResponsibilities).toBe(true);
    expect(domains.includeDashboard).toBe(true);
  });

  it("client_view never enables internal responsibility context", () => {
    const domains = selectDomains("client_view", "team_responsibility");
    expect(domains.includeResponsibilities).toBe(false);
  });
});
