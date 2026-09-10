import { describe, expect, it } from "vitest";
import { buildRetrievalPlan, domainsFromPlan } from "../src/lib/retrieval/planner.js";

function makePlan(overrides: Partial<Parameters<typeof buildRetrievalPlan>[0]> = {}) {
  return buildRetrievalPlan({
    intent: "current_truth",
    pageContext: "brain_overview",
    selectedRefType: null,
    selectedRefId: null,
    viewerState: null,
    isClientContext: false,
    retrievalTopK: 32,
    rerankTopK: 8,
    ...overrides,
  });
}

describe("buildRetrievalPlan", () => {
  it("routes current-truth through Product Brain before flat evidence", () => {
    const plan = makePlan({ intent: "current_truth" });

    expect(plan.primaryDomains).toEqual(
      expect.arrayContaining(["product_brain", "accepted_changes", "decisions", "brain_nodes"])
    );
    expect(plan.sourcePrecedence.slice(0, 3)).toEqual([
      "accepted_truth",
      "accepted_changes",
      "accepted_decisions",
    ]);
    expect(plan.requiresAcceptedTruth).toBe(true);
    expect(plan.requiresBrainGraph).toBe(true);
    expect(domainsFromPlan(plan).includeProductBrain).toBe(true);
  });

  it("routes provenance to original document and communication evidence first", () => {
    const plan = makePlan({ intent: "original_source" });

    expect(plan.primaryDomains).toEqual(
      expect.arrayContaining(["document_sections", "document_chunks", "communication_messages"])
    );
    expect(plan.sourcePrecedence.slice(0, 2)).toEqual(["source_evidence", "communication_evidence"]);
    expect(plan.requiresOriginalEvidence).toBe(true);
  });

  it("makes selected brain node expansion mandatory on brain graph pages", () => {
    const plan = makePlan({
      intent: "brain_local",
      pageContext: "brain_graph",
      selectedRefType: "brain_node",
      selectedRefId: "node-1",
    });

    expect(plan.selectedRef).toEqual({ type: "brain_node", id: "node-1" });
    expect(plan.mustInclude).toEqual(expect.arrayContaining(["brain_nodes", "brain_edges"]));
    expect(plan.requiresBrainGraph).toBe(true);
  });

  it("uses dashboard snapshots first for dashboard questions", () => {
    const plan = makePlan({ intent: "dashboard_status", pageContext: "dashboard_project" });

    expect(plan.primaryDomains[0]).toBe("dashboard_snapshots");
    expect(plan.sourcePrecedence[0]).toBe("dashboard_facts");
    expect(plan.mustInclude[0]).toBe("dashboard_snapshots");
  });

  it("routes team responsibility questions through project responsibility context first", () => {
    const plan = makePlan({ intent: "team_responsibility", pageContext: "dashboard_project" });

    expect(plan.primaryDomains[0]).toBe("project_responsibilities");
    expect(plan.sourcePrecedence[0]).toBe("team_context");
    expect(plan.mustInclude).toContain("project_responsibilities");
    expect(domainsFromPlan(plan).includeResponsibilities).toBe(true);
  });

  it("hard-filters internal communication and proposal domains in client view", () => {
    const plan = makePlan({
      intent: "communication_lookup",
      pageContext: "client_view",
      isClientContext: true,
    });

    expect(plan.primaryDomains).toEqual(["client_safe_documents", "client_safe_brain"]);
    expect(plan.forbiddenDomains).toEqual(
      expect.arrayContaining(["communication_messages", "communication_threads", "accepted_changes", "connector_metadata"])
    );
    expect(plan.roleSafety.allowInternalMessages).toBe(false);
    expect(domainsFromPlan(plan).includeCommunications).toBe(false);
  });

  it("does not route client-safe questions through internal dashboard snapshots", () => {
    const plan = makePlan({
      intent: "dashboard_status",
      pageContext: "client_view",
      isClientContext: true,
    });

    expect(plan.primaryDomains).toEqual(["client_safe_brain", "client_safe_documents"]);
    expect(plan.supportingDomains).not.toContain("dashboard_snapshots");
    expect(plan.mustInclude).not.toContain("dashboard_snapshots");
    expect(plan.sourcePrecedence).not.toContain("dashboard_facts");
    expect(domainsFromPlan(plan).includeDashboard).toBe(false);
  });
});
