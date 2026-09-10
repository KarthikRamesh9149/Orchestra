import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TruthChangePacketPage } from "./TruthChangePacketPage";

const mocks = vi.hoisted(() => ({ getTruthChangePacket: vi.fn(), actOnTruthInboxItem: vi.fn(), getDecisionDeliveryTrace: vi.fn(), issueDecisionReceipt: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ activeProject: { id: "project-1", name: "Workspace", projectRole: "manager" } }) }));
vi.mock("../lib/api/truthInbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api/truthInbox")>()), ...mocks }));
vi.mock("../lib/api/delivery", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api/delivery")>()), getDecisionDeliveryTrace: mocks.getDecisionDeliveryTrace, issueDecisionReceipt: mocks.issueDecisionReceipt }));

const item = {
  id: "proposal:proposal-1",
  sourceType: "proposal",
  sourceId: "proposal-1",
  category: "spec_drift",
  title: "Google login before launch",
  description: "New communication may change accepted authentication scope.",
  severity: "critical",
  confidence: 0.94,
  status: "active",
  sourceLabels: ["microsoft_teams"],
  evidence: [],
  limitations: [],
  owner: { userId: "user-1", displayName: "Karthik", email: "k@example.com" },
  clarification: null,
  deferredUntil: null,
  snoozedUntil: null,
  timelineEventRef: null,
  reviewProposalId: null,
  capabilities: {
    ask_socrates: true,
    assign_owner: true,
    request_clarification: true,
    create_review_item: false,
    accept: true,
    reject: true,
    defer: true,
    snooze: true,
    dismiss: false,
    promote_to_timeline: true
  },
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z"
};

function packet(overrides: Record<string, unknown> = {}) {
  return {
    id: "packet:proposal-1",
    projectId: "project-1",
    item,
    packetKind: "proposed_change",
    readiness: "decision_ready",
    newEvidence: [{
      id: "message-1",
      source: "microsoft_teams",
      label: "Launch scope · Client",
      excerpt: "Google login must be included before launch.",
      occurredAt: "2026-08-23T00:00:00.000Z",
      openTarget: { targetType: "message", targetRef: { messageId: "message-1", threadId: "thread-1", providerPermalink: "https://teams.example/message" } }
    }],
    currentAcceptedTruth: [{
      id: "node-1",
      type: "brain_node",
      label: "Authentication",
      detail: "Email and password login.",
      status: "accepted_flow",
      authority: "accepted_truth",
      openTarget: null
    }],
    recordedPriorUnderstanding: ["Authentication: Email and password only"],
    proposedChange: {
      proposalId: "proposal-1",
      proposalType: "requirement_change",
      status: "needs_review",
      title: "Google login before launch",
      summary: "Add Google login before launch.",
      statements: ["Authentication: Google login is required"]
    },
    potentialConflict: {
      summary: "The recorded prior and proposed understandings differ.",
      basis: ["A prior understanding and a proposed understanding are recorded."],
      interpretationOnly: true
    },
    affected: {
      productAreas: [{ id: "node-1", type: "brain_node", label: "Authentication", detail: "Email and password login.", status: "accepted_flow", authority: "accepted_truth", openTarget: null }],
      engineering: ["Engineering impact: high"],
      owners: [{ userId: "user-1", displayName: "Karthik", email: "k@example.com", source: "truth_inbox_assignment" }]
    },
    impactMap: {
      proposalId: "proposal-1",
      status: "partial",
      groups: [
        { key: "product_brain", label: "Product Brain", coverage: "mapped", items: [{ id: "impact-node-1", group: "product_brain", label: "Authentication", detail: "Email login flow.", status: "accepted flow", relationship: { kind: "direct_proposal_link", label: "Direct proposal link", reason: "The proposal explicitly links this Product Brain node." }, confidence: "verified", openTarget: { targetType: "product_brain", targetRef: { brainNodeId: "node-1" } } }] },
        { key: "requirements", label: "Requirements & constraints", coverage: "not_recorded", items: [] },
        { key: "live_doc", label: "Live Doc", coverage: "mapped", items: [{ id: "impact-live-1", group: "live_doc", label: "Authentication", detail: "Add Google sign-in.", status: "pending", relationship: { kind: "direct_proposal_link", label: "Direct proposal link", reason: "This Live Doc draft is explicitly linked to the proposal." }, confidence: "verified", openTarget: { targetType: "live_doc_section", targetRef: { sectionKey: "authentication" } } }] },
        { key: "source_documents", label: "Source documents", coverage: "mapped", items: [{ id: "impact-doc-1", group: "source_documents", label: "Launch PRD · Authentication", detail: "Email login is current scope.", status: "current version", relationship: { kind: "direct_proposal_link", label: "Direct proposal link", reason: "The proposal explicitly links this document section." }, confidence: "verified", openTarget: { targetType: "document_section", targetRef: { documentId: "doc-1", anchorId: "authentication" } } }] },
        { key: "previous_decisions", label: "Previous decisions", coverage: "not_recorded", items: [] },
        { key: "owners", label: "Responsible people", coverage: "mapped", items: [{ id: "impact-owner-1", group: "owners", label: "Karthik", detail: "k@example.com", status: "assigned", relationship: { kind: "direct_proposal_link", label: "Direct proposal link", reason: "This person is assigned to the Inbox item." }, confidence: "verified", openTarget: null }] },
        { key: "repositories", label: "Repositories", coverage: "not_recorded", items: [] },
        { key: "files_modules", label: "Files & modules", coverage: "not_recorded", items: [] },
        { key: "pull_requests", label: "Pull requests", coverage: "not_recorded", items: [] },
        { key: "tests", label: "Tests & checks", coverage: "not_recorded", items: [] },
        { key: "context_packs", label: "Agent context packs", coverage: "not_recorded", items: [] },
        { key: "agent_files", label: "Agent files", coverage: "not_recorded", items: [] },
        { key: "client_commitments", label: "Client commitments", coverage: "mapped", items: [{ id: "impact-client-1", group: "client_commitments", label: "Recorded client-expectation impact", detail: "Launch commitment may change.", status: "proposal record", relationship: { kind: "recorded_impact", label: "Recorded impact", reason: "This is recorded impact, not proof of client approval." }, confidence: "recorded", openTarget: null }] }
      ],
      summary: { mappedGroups: 5, totalGroups: 13, mappedItems: 5, verifiedItems: 4, recordedItems: 1 },
      generatedAt: "2026-08-23T00:00:00.000Z",
      limitations: ["Title similarity and unreviewed semantic guesses are deliberately excluded."]
    },
    confidence: { score: 0.94, label: "high", basis: ["1 source evidence record", "1 linked accepted-truth record"] },
    decision: { required: true, options: ["accept", "reject", "request_clarification", "defer"], blockers: [] },
    boundaries: [
      { stage: "evidence", state: "present", label: "Evidence", detail: "1 source record" },
      { stage: "interpretation", state: "present", label: "Interpretation", detail: "Workflow interpretation" },
      { stage: "proposed_change", state: "pending", label: "Proposed change", detail: "Awaiting a human decision" },
      { stage: "accepted_truth", state: "unchanged", label: "Accepted truth", detail: "1 linked record; unchanged" }
    ],
    generatedAt: "2026-08-23T00:00:00.000Z",
    limitations: ["Opening this packet never updates Product Brain or LiveDoc."],
    ...overrides
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/truth-inbox/proposal%3Aproposal-1"]}>
      <Routes>
        <Route path="/truth-inbox/:itemId" element={<TruthChangePacketPage />} />
        <Route path="/truth-inbox" element={<p>Inbox destination</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("TruthChangePacketPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTruthChangePacket.mockResolvedValue(packet());
    mocks.actOnTruthInboxItem.mockResolvedValue({ item: null, outcome: { proposal: { status: "accepted" } }, action: "accept" });
    mocks.getDecisionDeliveryTrace.mockResolvedValue({
      id: "trace:proposal-1", projectId: "project-1", proposalId: "proposal-1", decisionRecordId: null,
      title: "Google login before launch", status: "awaiting_decision", completedSteps: 2, applicableSteps: 10,
      receiptEligible: false, receiptBlockers: ["Human approved: Accept or reject the proposal through the Truth Inbox."], receipt: null,
      steps: [{ key: "change_proposed", label: "Change proposed", status: "complete", owner: null, occurredAt: "2026-08-23T00:00:00.000Z", detail: "Proposal recorded.", evidence: [], remainingGap: null }],
      generatedAt: "2026-08-23T00:00:00.000Z", limitations: ["The trace never updates accepted truth by itself."]
    });
    mocks.issueDecisionReceipt.mockResolvedValue(null);
  });

  it("renders the evidence-to-truth boundary and exact packet content", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Google login before launch" })).toBeVisible();
    expect(screen.getByText("Evidence", { exact: true })).toBeVisible();
    expect(screen.getAllByText("Accepted truth", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("Google login must be included before launch.")).toBeVisible();
    expect(screen.getByText("Authentication: Email and password only")).toBeVisible();
    expect(screen.getByText("Authentication: Google login is required")).toBeVisible();
    expect(screen.getByText("Interpretation only")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Change Impact Map" })).toBeVisible();
    expect(screen.getByText("5/13")).toBeVisible();
    expect(screen.getByText("Recorded client-expectation impact")).toBeVisible();
    expect(screen.getByRole("link", { name: /Open provider message/ })).toHaveAttribute("href", "https://teams.example/message");
  });

  it("requires explicit confirmation and delegates acceptance to the backend", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Accept change" }));
    expect(screen.getByText("Confirm this evidence-backed proposal as accepted truth?")).toBeVisible();
    expect(mocks.actOnTruthInboxItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.actOnTruthInboxItem).toHaveBeenCalledWith("project-1", item.id, "accept", {}));
    expect(await screen.findByText("Inbox destination")).toBeVisible();
  });

  it("does not render acceptance when authoritative context blockers remain", async () => {
    mocks.getTruthChangePacket.mockResolvedValue(packet({
      readiness: "needs_context",
      currentAcceptedTruth: [],
      decision: { required: true, options: ["reject", "request_clarification", "defer"], blockers: ["No linked accepted Product Brain node was resolved."] }
    }));
    renderPage();
    expect(await screen.findByText("No linked accepted Product Brain node was resolved.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Accept change" })).not.toBeInTheDocument();
  });

  it("reports packet load failures honestly", async () => {
    mocks.getTruthChangePacket.mockRejectedValue(new Error("Packet source unavailable"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Packet source unavailable");
  });

  it("describes missing engineering links without obsolete roadmap promises", async () => {
    mocks.getTruthChangePacket.mockResolvedValue(packet({ affected: { productAreas: [], engineering: [], owners: [] } }));
    renderPage();
    expect(await screen.findByText("No verified engineering impact links are recorded yet.")).toBeVisible();
    expect(screen.queryByText(/Feature 3 will/)).not.toBeInTheDocument();
  });
});
