import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const sessionId = "22222222-2222-4222-8222-222222222222";
  let history: Array<Record<string, unknown>> = [];
  const fulfillData = (route: Parameters<Parameters<typeof page.route>[1]>[0], data: unknown) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data, meta: null, error: null }),
  });
  await page.route("http://localhost:3000/v1/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/mission-control")) return fulfillData(route, {
      stats: [{ id: "open-prs", label: "Open PRs", value: "2", trend: [1, 2], source: "github", tone: "teal" }],
      team: [{ id: "member-1", name: "E2E User", initials: "EU", role: "manager", isActive: true }],
      recentChanges: [], calendarEvents: [], slackMessages: [], gitCommits: [], activity: [], socratesQueries: [],
      updatedAt: "2026-08-20T00:00:00.000Z",
    });
    if (pathname.endsWith("/subscriptions")) return fulfillData(route, []);
    if (pathname.endsWith("/documents")) return fulfillData(route, []);
    if (pathname.endsWith("/connectors/readiness")) return fulfillData(route, []);
    if (pathname.endsWith("/connectors")) return fulfillData(route, []);
    if (pathname.endsWith("/threads")) return fulfillData(route, []);
    if (pathname.endsWith("/timeline")) return fulfillData(route, { items: [{
      id: "manual:event-1", title: "Responsive release checkpoint", description: "Verified across supported viewports.",
      source: "manual", sourceRef: null, author: { name: "E2E User", initials: "EU", color: "#2A9D8F" },
      timestamp: "2026-08-20T00:00:00.000Z", tier: "milestone", type: "change", status: "approved",
    }] });
    if (pathname.endsWith("/integrations/status")) return fulfillData(route, { providers: [] });
    if (pathname.endsWith("/settings")) return fulfillData(route, {
      projectId: "e2e-project", name: "E2E Workspace", slug: "e2e-workspace", createdAt: "2026-08-20T00:00:00.000Z",
    });
    if (pathname.endsWith("/members")) return fulfillData(route, { members: [{
      id: "membership-1", userId: "e2e-user", projectRole: "manager", isActive: true, canApproveTruthChanges: true,
      user: { displayName: "E2E User", email: "e2e@example.com" },
    }] });
    if (pathname.endsWith("/join-codes")) return fulfillData(route, []);
    if (pathname === "/v1/me/profile") return fulfillData(route, {
      userId: "e2e-user", displayName: "E2E User", email: "e2e@example.com", emailVerified: false,
      globalRole: "owner", timezone: "Australia/Sydney", createdAt: "2026-08-20T00:00:00.000Z",
    });
    if (pathname === "/v1/me/sessions") return fulfillData(route, []);
    if (pathname === "/v1/me/appearance-preference") return fulfillData(route, { theme: "light", updatedAt: "2026-08-20T00:00:00.000Z" });
    if (pathname === "/v1/me/linked-accounts") return fulfillData(route, []);
    if (pathname.endsWith("/deep-research/usage")) return fulfillData(route, { used: 0, limit: 5, resetLabel: "tomorrow" });
    return route.fallback();
  });
  await page.route("http://localhost:3000/v1/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        id: "e2e-user",
        orgId: "e2e-org",
        email: "e2e@example.com",
        displayName: "E2E User",
        globalRole: "owner",
        workspaceRoleDefault: "manager",
        emailVerified: false
      },
      meta: null,
      error: null
    })
  }));
  await page.route("http://localhost:3000/v1/me/workspaces", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: [{
        projectId: "e2e-project",
        name: "E2E Workspace",
        slug: "e2e-workspace",
        organizationId: "e2e-org",
        organizationName: "E2E Org",
        organizationSlug: "e2e-org",
        role: "manager",
        current: true
      }],
      meta: null,
      error: null
    })
  }));
  await page.route("http://localhost:3000/v1/auth/csrf", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { csrfToken: "e2e-chat-csrf" }, meta: null, error: null })
  }));
  await page.route("http://localhost:3000/v1/projects/e2e-project/socrates/sessions?limit=30", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: history.length ? [{
      id: sessionId,
      projectId: "e2e-project",
      pageContext: "dashboard_project",
      title: "Keep this first message",
      preview: "From project memory: persisted answer.",
      messageCount: history.length,
      createdAt: "2026-08-19T01:00:00.000Z",
      updatedAt: "2026-08-19T01:00:01.000Z"
    }] : [], meta: null, error: null })
  }));
  await page.route("http://localhost:3000/v1/projects/e2e-project/socrates/messages/stream/v1", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("e2e-chat-csrf");
    const body = route.request().postDataJSON();
    expect(body.sessionId).toBeNull();
    const fidelityPayload = {
      citations: [{ refId: "doc:launch", sourceType: "document", label: "Launch plan", excerpt: "Friday", openTargetId: "target:launch" }],
      open_targets: [{ id: "target:launch", sourceType: "document", targetType: "document_section", targetRef: { documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", anchorId: "launch" } }],
      suggested_prompts: [], confidence: "high", limitations: ["Evidence-only fallback."],
      artifact: { id: "artifact:launch", type: "summary", title: "Launch brief", contentMd: "### Decision\n\nShip **Friday**.", payload: {}, sourceRefs: [{ sourceType: "document", refId: "doc:launch", label: "Launch plan" }], generatedAt: "2026-08-20T00:00:00.000Z" },
      sourceStates: { clickup: { state: "unavailable", count: 0, message: "ClickUp is not connected." } },
      modelMetadata: { provider: "deterministic", model: null, degraded: true }
    };
    history = [
      { id: "33333333-3333-4333-8333-333333333333", sessionId, role: "user", content: body.question, responseStatus: null, createdAt: "2026-08-19T01:00:00.000Z" },
      { id: "44444444-4444-4444-8444-444444444444", sessionId, role: "assistant", content: "## From project memory\n\nThe launch is **Friday**.", responseStatus: "completed", answerPayloadJson: fidelityPayload, createdAt: "2026-08-19T01:00:01.000Z" }
    ];
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `event: message_created\ndata: ${JSON.stringify({ sessionId, userMessageId: history[0]?.id, assistantMessageId: history[1]?.id })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "From project " })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "memory: persisted answer." })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          answer_md: "## From project memory\n\nThe launch is **Friday**.", ...fidelityPayload, sessionId,
          message: { userMessageId: history[0]?.id, assistantMessageId: history[1]?.id, createdAt: "2026-08-19T01:00:01.000Z" }
        })}\n\n`
      ].join("")
    });
  });
  await page.route(`http://localhost:3000/v1/projects/e2e-project/socrates/sessions/${sessionId}/messages`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: history, meta: null, error: null })
  }));
  await page.goto("/chat");
  await expect(page.getByPlaceholder("Ask Socrates anything about your project…")).toBeVisible();
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; } [data-testid='socrates-hero-word'] > span { opacity: 1 !important; transform: none !important; }",
  });
});

test("empty Chat remains visually stable", async ({ page }) => {
  await expect(page).toHaveScreenshot("chat-empty.png", { fullPage: true });
});

test("major beta surfaces remain usable and visually stable without horizontal overflow", async ({ page }) => {
  for (const surface of ["dashboard", "chat", "memory", "timeline", "settings"] as const) {
    await page.goto(`/${surface}`);
    await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; } [data-testid='socrates-hero-word'] > span { opacity: 1 !important; transform: none !important; }" });
    await expect(page.locator("body")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (surface === "chat") {
      const hero = await page.getByTestId("socrates-hero-word").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, fontSize: Number.parseFloat(getComputedStyle(element.firstElementChild!).fontSize) };
      });
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(hero.width).toBeLessThanOrEqual(viewportWidth - 60);
      expect(hero.left).toBeGreaterThanOrEqual(52);
      expect(hero.right).toBeLessThanOrEqual(viewportWidth);
      expect(hero.fontSize).toBeLessThanOrEqual(viewportWidth < 640 ? 38 : viewportWidth < 1024 ? 72 : 96);
    }
    await expect(page).toHaveScreenshot(`${surface}-responsive.png`, { fullPage: true });
  }

  await page.goto("/chat");
  await page.getByRole("button", { name: /Deep Research/i }).click();
  const dialog = page.locator("section").filter({ hasText: "Configure your Deep Research" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty("scrollWidth", await dialog.evaluate((element) => element.clientWidth));
  await expect(page).toHaveScreenshot("deep-research-responsive.png", { fullPage: true });
});

test("primary navigation reaches each exposed beta route", async ({ page }) => {
  for (const [name, pathname] of [
    ["Dashboard", "/dashboard"],
    ["Memory", "/memory"],
    ["Settings", "/settings"],
    ["Chat", "/chat"],
  ] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${pathname}/?$`));
  }
});

test("an unsent Socrates draft survives leaving Chat and returning", async ({ page }) => {
  const draft = "Keep this draft while I inspect Memory";
  await page.getByPlaceholder("Ask Socrates anything about your project…").fill(draft);
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page).toHaveURL(/\/memory\/?$/);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/?$/);
  await expect(page.getByPlaceholder("Ask Socrates anything about your project…")).toHaveValue(draft);
});

test("first Chat request and response survive conversation navigation exactly once", async ({ page }) => {
  const question = "Keep this first message";
  await page.getByPlaceholder("Ask Socrates anything about your project…").fill(question);
  await page.getByPlaceholder("Ask Socrates anything about your project…").press("Enter");

  await expect(page).toHaveURL(/\/chat\/22222222-2222-4222-8222-222222222222$/);
  await expect(page.getByText(question, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/From project memory/)).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Open document/ })).toHaveAttribute("href", /\/memory\/docs\//);
  await expect(page.getByText("Evidence-only fallback", { exact: true })).toBeVisible();
  await expect(page.getByText("ClickUp is not connected.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Artifact: Launch brief" })).toBeVisible();

  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/22222222-2222-4222-8222-222222222222$/);
  await expect(page.getByText(question, { exact: true })).toHaveCount(1);

  await page.reload();
  await expect(page).toHaveURL(/\/chat\/22222222-2222-4222-8222-222222222222$/);
  await expect(page.getByText(question, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/From project memory/)).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Open document/ })).toHaveAttribute("href", /\/memory\/docs\//);
  await expect(page.getByText("ClickUp is not connected.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Artifact: Launch brief" })).toBeVisible();
});

test("Socrates handoff preserves its prefilled question", async ({ page }) => {
  await page.goto("/socrates?prefill=What%20changed%20today%3F");
  await expect(page).toHaveURL(/\/chat\?prefill=What%20changed%20today%3F$/);
  await expect(page.getByPlaceholder("Ask Socrates anything about your project…")).toHaveValue("What changed today?");
});

test("major beta surfaces have zero automated WCAG A or AA violations", async ({ page }) => {
  test.slow();
  for (const theme of ["light", "dark"] as const) {
    for (const surface of ["dashboard", "chat", "memory", "timeline", "settings"] as const) {
      await page.goto(`/${surface}`);
      await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; } [style*='opacity'] { opacity: 1 !important; } [style*='transform'] { transform: none !important; }" });
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      await expect(page.locator("body")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, `${theme}/${surface}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    }
  }
});

test("custom dialogs trap focus, close with Escape, restore their opener, and pass axe", async ({ page }) => {
  const assertDialog = async (dialog: ReturnType<typeof page.getByRole>, initialFocus: ReturnType<typeof page.getByRole>, opener: ReturnType<typeof page.getByRole>) => {
    await expect(dialog).toBeVisible();
    await expect(initialFocus).toBeFocused();
    await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; } [style*='opacity'] { opacity: 1 !important; } [style*='transform'] { transform: none !important; }" });
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      const results = await new AxeBuilder({ page })
        .include("[role='dialog']")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, `${theme}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  };

  await page.goto("/dashboard");
  const subscriptionOpener = page.getByRole("button", { name: "+ Add Subscription" });
  await subscriptionOpener.click();
  const subscriptionDialog = page.getByRole("dialog", { name: "Add Subscription" });
  await assertDialog(subscriptionDialog, page.getByRole("textbox", { name: "Service name" }), subscriptionOpener);

  await page.goto("/timeline");
  const eventOpener = page.getByRole("button", { name: "Add Event" });
  await eventOpener.click();
  const eventDialog = page.getByRole("dialog", { name: "Add Event" });
  await expect(page.getByRole("textbox", { name: "Event title" })).toBeFocused();
  await eventDialog.getByRole("button", { name: "Close add event" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(eventDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await assertDialog(eventDialog, eventDialog.getByRole("button", { name: "Cancel" }), eventOpener);

  await page.goto("/chat");
  const researchOpener = page.getByRole("button", { name: /Deep Research/i });
  await researchOpener.click();
  const researchDialog = page.getByRole("dialog", { name: "Configure your Deep Research" });
  await assertDialog(researchDialog, page.getByRole("textbox", { name: "Research focus" }), researchOpener);
});

test("navigation and view selectors expose their authoritative selected state", async ({ page }) => {
  await page.goto("/memory");
  await expect(page.getByRole("button", { name: "Memory", exact: true })).toHaveAttribute("aria-current", "page");
  const memoryPanelTab = page.getByRole("tab", { name: "memory" });
  await expect(memoryPanelTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true");
  await memoryPanelTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/timeline\/?$/);
  await expect(page.getByRole("tab", { name: "timeline" })).toHaveAttribute("aria-selected", "true");

  await page.goto("/timeline");
  await expect(page.getByRole("tab", { name: "timeline" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "summary" })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "light", exact: true })).toHaveAttribute("aria-pressed", "true");
});
