import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const userId = "11111111-1111-4111-8111-111111111111";
let assignedOwnerId: string | null = null;

function envelope(data: unknown) {
  return JSON.stringify({ data, meta: null, error: null });
}

function inboxPayload() {
  return {
    items: [{
      id: "proposal:33333333-3333-4333-8333-333333333333",
      sourceType: "proposal",
      sourceId: "33333333-3333-4333-8333-333333333333",
      category: "spec_drift",
      title: "Google login requested before launch",
      description: "A Teams request may change the accepted authentication scope.",
      severity: "critical",
      confidence: 0.94,
      status: "active",
      sourceLabels: ["microsoft_teams"],
      evidence: [{
        id: "message:44444444-4444-4444-8444-444444444444",
        source: "message",
        label: "Teams launch thread",
        excerpt: "Google login must be included before launch.",
        occurredAt: "2026-08-23T00:00:00.000Z",
        openTarget: { targetType: "message", targetRef: { messageId: "44444444-4444-4444-8444-444444444444" } }
      }],
      limitations: ["This remains proposed until an authorized truth approver accepts it."],
      owner: assignedOwnerId ? { userId, displayName: "Karthik Ramesh", email: "karthik@example.com" } : null,
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
    }],
    members: [{
      userId,
      displayName: "Karthik Ramesh",
      email: "karthik@example.com",
      projectRole: "manager",
      canApproveTruthChanges: true
    }],
    summary: { active: 1, critical: 1, awaitingDecision: 1, assignedToMe: assignedOwnerId ? 1 : 0 },
    countsByCategory: { spec_drift: 1 },
    countsByStatus: { active: 1 },
    sourceStates: { microsoft_teams: { state: "ready", label: "Microsoft Teams", detail: null } },
    page: { limit: 30, hasMore: false, nextCursor: null },
    generatedAt: "2026-08-23T00:00:00.000Z",
    cached: false,
    limitations: ["Evidence is not accepted truth until an authorized decision."]
  };
}

function packetPayload() {
  return {
    id: "packet:33333333-3333-4333-8333-333333333333",
    projectId: "e2e-project",
    item: { ...inboxPayload().items[0], limitations: [] },
    packetKind: "proposed_change",
    readiness: "decision_ready",
    newEvidence: [{
      id: "message:44444444-4444-4444-8444-444444444444",
      source: "microsoft_teams",
      label: "Launch scope · Client",
      excerpt: "Google login must be included before launch.",
      occurredAt: "2026-08-23T00:00:00.000Z",
      openTarget: { targetType: "message", targetRef: { messageId: "44444444-4444-4444-8444-444444444444", threadId: "55555555-5555-4555-8555-555555555555", providerPermalink: "https://teams.example/message" } }
    }],
    currentAcceptedTruth: [{
      id: "66666666-6666-4666-8666-666666666666",
      type: "brain_node",
      label: "Authentication",
      detail: "Email and password login is the currently accepted flow.",
      status: "accepted_flow",
      authority: "accepted_truth",
      openTarget: null
    }],
    recordedPriorUnderstanding: ["Authentication: Email and password only"],
    proposedChange: {
      proposalId: "33333333-3333-4333-8333-333333333333",
      proposalType: "requirement_change",
      status: "needs_review",
      title: "Google login requested before launch",
      summary: "Add Google login before launch.",
      statements: ["Authentication: Google login is required"]
    },
    potentialConflict: {
      summary: "The recorded prior understanding and the proposed understanding differ and require an explicit human decision.",
      basis: ["A prior understanding is recorded.", "A different proposed understanding is recorded."],
      interpretationOnly: true
    },
    affected: {
      productAreas: [{ id: "66666666-6666-4666-8666-666666666666", type: "brain_node", label: "Authentication", detail: "Email and password login.", status: "accepted_flow", authority: "accepted_truth", openTarget: null }],
      engineering: ["Engineering impact: high", "Scope impact: high"],
      owners: []
    },
    impactMap: {
      proposalId: "33333333-3333-4333-8333-333333333333",
      status: "partial",
      groups: [
        { key: "product_brain", label: "Product Brain", coverage: "mapped", items: [{ id: "impact-node", group: "product_brain", label: "Authentication", detail: "Email and password login is the currently accepted flow.", status: "accepted flow", relationship: { kind: "direct_proposal_link", label: "Direct proposal link", reason: "The proposal explicitly links this Product Brain node." }, confidence: "verified", openTarget: { targetType: "product_brain", targetRef: { brainNodeId: "66666666-6666-4666-8666-666666666666" } } }] },
        { key: "requirements", label: "Requirements & constraints", coverage: "mapped", items: [{ id: "impact-requirement", group: "requirements", label: "Authentication constraint", detail: "Launch authentication must match approved scope.", status: "accepted", relationship: { kind: "persisted_graph_link", label: "Persisted graph link", reason: "A Brain-to-section relationship connects this constraint to the affected PRD section." }, confidence: "related", openTarget: null }] },
        { key: "live_doc", label: "Live Doc", coverage: "mapped", items: [{ id: "impact-live", group: "live_doc", label: "Authentication", detail: "Add Google sign-in.", status: "pending", relationship: { kind: "direct_proposal_link", label: "Direct proposal link", reason: "This Live Doc draft is explicitly linked to the proposal." }, confidence: "verified", openTarget: { targetType: "live_doc_section", targetRef: { sectionKey: "authentication" } } }] },
        { key: "source_documents", label: "Source documents", coverage: "mapped", items: [{ id: "impact-doc", group: "source_documents", label: "Launch PRD · Authentication", detail: "Email login is the current scope.", status: "current version", relationship: { kind: "direct_proposal_link", label: "Direct proposal link", reason: "The proposal explicitly links this document section." }, confidence: "verified", openTarget: { targetType: "document_section", targetRef: { documentId: "77777777-7777-4777-8777-777777777777", anchorId: "authentication" } } }] },
        { key: "previous_decisions", label: "Previous decisions", coverage: "mapped", items: [{ id: "impact-decision", group: "previous_decisions", label: "Email login baseline", detail: "Launch with email and password login.", status: "accepted", relationship: { kind: "accepted_shared_reference", label: "Accepted shared reference", reason: "This accepted decision shares the affected authentication section." }, confidence: "verified", openTarget: null }] },
        { key: "owners", label: "Responsible people", coverage: "not_recorded", items: [] },
        { key: "repositories", label: "Repositories", coverage: "mapped", items: [{ id: "impact-repo", group: "repositories", label: "orchestra/web", detail: "Authentication implementation", status: "active", relationship: { kind: "persisted_graph_link", label: "Persisted graph link", reason: "This repository is cited by a decision-to-engineering link." }, confidence: "verified", openTarget: { targetType: "github_evidence", targetRef: { repo: "orchestra/web" } } }] },
        { key: "files_modules", label: "Files & modules", coverage: "mapped", items: [{ id: "impact-file", group: "files_modules", label: "src/auth/google.ts", detail: "Google OAuth callback", status: "active", relationship: { kind: "persisted_graph_link", label: "Persisted graph link", reason: "This file is cited by a decision-to-engineering link." }, confidence: "verified", openTarget: null }] },
        { key: "pull_requests", label: "Pull requests", coverage: "mapped", items: [{ id: "impact-pr", group: "pull_requests", label: "orchestra/web #42", detail: "Add Google login", status: "open", relationship: { kind: "persisted_graph_link", label: "Persisted graph link", reason: "This pull request is cited by a decision-to-engineering link." }, confidence: "verified", openTarget: null }] },
        { key: "tests", label: "Tests & checks", coverage: "mapped", items: [{ id: "impact-test", group: "tests", label: "tests/auth.spec.ts", detail: "Authentication browser coverage", status: "passing", relationship: { kind: "persisted_graph_link", label: "Persisted graph link", reason: "This test is cited by a decision-to-engineering link." }, confidence: "verified", openTarget: null }] },
        { key: "context_packs", label: "Agent context packs", coverage: "mapped", items: [{ id: "impact-pack", group: "context_packs", label: "Google login implementation", detail: "Implementation context generated from current truth.", status: "active", relationship: { kind: "persisted_graph_link", label: "Persisted graph link", reason: "This pack contains the affected proposal as a persisted source." }, confidence: "verified", openTarget: null }] },
        { key: "agent_files", label: "Agent files", coverage: "mapped", items: [{ id: "impact-agent", group: "agent_files", label: "AGENTS.md", detail: "Orchestra agent files · main", status: "current", relationship: { kind: "persisted_graph_link", label: "Persisted graph link", reason: "This file records an affected Product Brain version." }, confidence: "verified", openTarget: null }] },
        { key: "client_commitments", label: "Client commitments", coverage: "mapped", items: [{ id: "impact-client", group: "client_commitments", label: "Recorded client-expectation impact", detail: "Launch commitment may change.", status: "proposal record", relationship: { kind: "recorded_impact", label: "Recorded impact", reason: "This is recorded on the proposal, not proof of approval." }, confidence: "recorded", openTarget: null }] }
      ],
      summary: { mappedGroups: 12, totalGroups: 13, mappedItems: 12, verifiedItems: 10, recordedItems: 1 },
      generatedAt: "2026-08-23T00:00:00.000Z",
      limitations: ["Title similarity and unreviewed semantic guesses are deliberately excluded.", "An empty group means no persisted relationship, not no impact."]
    },
    confidence: { score: 0.94, label: "high", basis: ["1 available source evidence record", "1 linked accepted-truth record"] },
    decision: { required: true, options: ["accept", "reject", "request_clarification", "defer"], blockers: [] },
    boundaries: [
      { stage: "evidence", state: "present", label: "Evidence", detail: "1 source record" },
      { stage: "interpretation", state: "present", label: "Interpretation", detail: "Workflow interpretation; never truth by itself" },
      { stage: "proposed_change", state: "pending", label: "Proposed change", detail: "Awaiting an authorized human decision" },
      { stage: "accepted_truth", state: "unchanged", label: "Accepted truth", detail: "1 linked accepted record; unchanged by opening this packet" }
    ],
    generatedAt: "2026-08-23T00:00:00.000Z",
    limitations: ["Opening this packet never updates Product Brain or LiveDoc."]
  };
}

test.beforeEach(async ({ page }) => {
  assignedOwnerId = null;
  await page.route("http://localhost:3000/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const fulfill = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: envelope(data) });

    if (pathname === "/v1/auth/me") return fulfill({
      id: userId,
      orgId: "22222222-2222-4222-8222-222222222222",
      email: "karthik@example.com",
      displayName: "Karthik Ramesh",
      globalRole: "owner",
      workspaceRoleDefault: "manager",
      emailVerified: true
    });
    if (pathname === "/v1/me/workspaces") return fulfill([{
      projectId: "e2e-project",
      name: "Orchestra E2E",
      slug: "orchestra-e2e",
      organizationId: "22222222-2222-4222-8222-222222222222",
      organizationName: "Orchestra",
      organizationSlug: "orchestra",
      role: "manager",
      current: true
    }]);
    if (pathname === "/v1/me/appearance-preference") return fulfill({ theme: "light", updatedAt: "2026-08-23T00:00:00.000Z" });
    if (pathname === "/v1/auth/csrf") return fulfill({ csrfToken: "truth-inbox-e2e-csrf" });
    if (pathname === `/v1/projects/e2e-project/truth-inbox` && request.method() === "GET") return fulfill(inboxPayload());
    if (pathname.endsWith("/packet") && request.method() === "GET") return fulfill(packetPayload());
    if (pathname.endsWith("/actions/assign_owner") && request.method() === "POST") {
      expect(request.headers()["x-csrf-token"]).toBe("truth-inbox-e2e-csrf");
      assignedOwnerId = (request.postDataJSON() as { assignedUserId: string }).assignedUserId;
      return fulfill({ item: inboxPayload().items[0], outcome: null, action: "assign_owner" });
    }
    if (pathname.endsWith("/actions/accept") && request.method() === "POST") {
      expect(request.headers()["x-csrf-token"]).toBe("truth-inbox-e2e-csrf");
      return fulfill({ item: null, outcome: { proposal: { status: "accepted" } }, action: "accept" });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ data: null, meta: null, error: { code: "unmocked_e2e_route", message: pathname } })
    });
  });

  await page.goto("/truth-inbox");
  await expect(page.getByRole("heading", { name: "Truth Inbox" })).toBeVisible();
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
});

test("Truth Inbox is responsive, visually stable, and WCAG AA clean", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("heading", { name: "Google login requested before launch" })).toBeVisible();
  await page.getByText("View evidence (1)").click();
  await expect(page.getByText("Google login must be included before launch.")).toBeVisible();

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, `${theme}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
  }

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.getByRole("heading", { name: "Truth Inbox" }).scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot("truth-inbox.png", { fullPage: true });
});

test("owner assignment is authoritative and survives reload", async ({ page }) => {
  const owner = page.getByRole("combobox", { name: "Owner for Google login requested before launch" });
  await owner.selectOption(userId);
  await expect(owner).toHaveValue(userId);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Truth Inbox" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Owner for Google login requested before launch" })).toHaveValue(userId);
});

test("Truth Change Packet preserves state boundaries, responsiveness, and explicit approval", async ({ page }) => {
  await page.getByRole("link", { name: /Open change packet/ }).click();
  await expect(page).toHaveURL(/\/truth-inbox\/proposal%3A33333333-3333-4333-8333-333333333333$/);
  await expect(page.getByText("Evidence", { exact: true })).toBeVisible();
  await expect(page.getByText("Accepted truth", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Interpretation only")).toBeVisible();
  await expect(page.getByText("Authentication: Google login is required")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change Impact Map" })).toBeVisible();
  await expect(page.getByText("12/13")).toBeVisible();
  await expect(page.getByText("AGENTS.md")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.addStyleTag({ content: "[style*='opacity'] { opacity: 1 !important; } [style*='transform'] { transform: none !important; }" });

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, `${theme}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
  }

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.getByRole("heading", { name: "Google login requested before launch" }).scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot("truth-change-packet.png", { fullPage: true });
  const impactMap = page.getByRole("region", { name: "Change Impact Map" });
  await impactMap.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await expect(page).toHaveScreenshot("truth-impact-map.png");

  await page.getByRole("button", { name: "Accept change" }).click();
  await expect(page.getByText("Confirm this evidence-backed proposal as accepted truth?")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/truth-inbox\/?$/);
});
