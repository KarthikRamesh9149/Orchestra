import { expect, test, type Route } from "@playwright/test";

const projectId = "truth-project";
const userId = "truth-user";
const workspaceName = "Truth Sentinel Workspace";
const displayName = "Truth Sentinel User";
const fixtureNow = "2040-03-04T05:06:00.000Z";
const dashboardUpdatedAt = "2040-03-04T05:00:00.000Z";

const envelope = (data: unknown) => ({ data, meta: null, error: null });

async function fulfill(route: Route, data: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(envelope(data)) });
}

async function rejectWrite(route: Route) {
  await route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({
      data: null,
      meta: null,
      error: { code: "PERSISTENCE_REJECTED", message: "Write rejected by authoritative backend." },
    }),
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.addInitScript(({ projectId, workspaceName, displayName }) => {
    window.localStorage.setItem("orchestra-theme", "light");
    window.localStorage.setItem("orchestra_workspace", JSON.stringify({
      state: {
        userRole: "manager",
        profileName: displayName,
        profileEmail: "truth@example.test",
        workspaceName,
        activeProjectId: projectId,
        onboardingComplete: true,
      },
      version: 0,
    }));
  }, { projectId, workspaceName, displayName });

  await page.route("http://localhost:3000/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (method === "POST" && (
      pathname === `/v1/projects/${projectId}/subscriptions` ||
      pathname === `/v1/projects/${projectId}/timeline/events` ||
      pathname === `/v1/projects/${projectId}/documents/upload`
    )) return rejectWrite(route);
    if (method === "PATCH" && pathname === `/v1/projects/${projectId}/settings`) return rejectWrite(route);

    if (pathname === "/v1/auth/csrf") return fulfill(route, { csrfToken: "truth-csrf" });
    if (pathname === "/v1/auth/me") return fulfill(route, {
      id: userId,
      orgId: "truth-org",
      email: "truth@example.test",
      displayName,
      globalRole: "owner",
      workspaceRoleDefault: "manager",
      emailVerified: false,
    });
    if (pathname === "/v1/me/workspaces") return fulfill(route, [{
      projectId,
      name: workspaceName,
      slug: "truth-sentinel-workspace",
      organizationId: "truth-org",
      organizationName: "Truth Sentinel Org",
      organizationSlug: "truth-sentinel-org",
      role: "manager",
      current: true,
    }]);
    if (pathname === "/v1/me/profile") return fulfill(route, {
      userId,
      displayName,
      email: "truth@example.test",
      emailVerified: false,
      globalRole: "owner",
      timezone: "Australia/Sydney",
      createdAt: fixtureNow,
    });
    if (pathname === "/v1/me/sessions" || pathname === "/v1/me/linked-accounts") return fulfill(route, []);
    if (pathname === "/v1/me/appearance-preference") return fulfill(route, { theme: "light", updatedAt: fixtureNow });

    if (pathname === `/v1/projects/${projectId}/settings`) return fulfill(route, {
      projectId,
      name: workspaceName,
      slug: "truth-sentinel-workspace",
      createdAt: fixtureNow,
    });
    if (pathname === `/v1/projects/${projectId}/members`) return fulfill(route, { members: [] });
    if (pathname === `/v1/projects/${projectId}/join-codes`) return fulfill(route, []);
    if (pathname === `/v1/projects/${projectId}/integrations/status`) return fulfill(route, { providers: [] });
    if (pathname === `/v1/projects/${projectId}/connectors/readiness` || pathname === `/v1/projects/${projectId}/connectors`) return fulfill(route, []);
    if (pathname === `/v1/projects/${projectId}/threads`) return fulfill(route, []);
    if (pathname === `/v1/projects/${projectId}/documents`) return fulfill(route, []);
    if (pathname === `/v1/projects/${projectId}/subscriptions`) return fulfill(route, []);
    if (pathname === `/v1/projects/${projectId}/mission-control`) return fulfill(route, {
      stats: [],
      team: [],
      recentChanges: [],
      calendarEvents: [],
      slackMessages: [],
      gitCommits: [],
      activity: [],
      socratesQueries: [],
      updatedAt: dashboardUpdatedAt,
    });
    if (pathname === `/v1/projects/${projectId}/timeline`) return fulfill(route, { items: [] });
    if (pathname === `/v1/projects/${projectId}/socrates/sessions`) return fulfill(route, []);
    if (pathname === `/v1/projects/${projectId}/deep-research/usage`) return fulfill(route, { used: 0, limit: 5, resetLabel: "tomorrow" });

    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ data: null, meta: null, error: { code: "UNHANDLED_TEST_ROUTE", message: `${method} ${pathname}` } }),
    });
  });
});

test("empty workspace renders only authoritative empty states across major beta surfaces", async ({ page }) => {
  const assertNoFabrication = async () => {
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/BloomFast|Demo User|E2E User|Karthik Ramesh|Responsive release checkpoint|a3f9c21|AWS \(EC2/i);
  };

  await page.goto("/dashboard");
  await expect(page.getByText("No recent review items.")).toBeVisible();
  await expect(page.getByText("No recent Slack messages.")).toBeVisible();
  await expect(page.getByText("No GitHub commit evidence.")).toBeVisible();
  await expect(page.getByText("No recent customer-facing activity.")).toBeVisible();
  await expect(page.getByText("No recent Socrates queries.")).toBeVisible();
  await expect(page.getByText("No project subscriptions have been added.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Updated .*2040/i })).toBeVisible();
  await assertNoFabrication();

  await page.goto("/memory");
  await expect(page.getByText("0 docs · 0 connectors")).toBeVisible();
  await expect(page.getByText("No documents uploaded yet. Drag a PDF or DOCX above to get started.")).toBeVisible();
  await assertNoFabrication();

  await page.goto("/timeline");
  await expect(page.getByText("No events match this filter")).toBeVisible();
  await expect(page.getByRole("button", { name: "All sources" })).toBeVisible();
  await assertNoFabrication();

  await page.goto("/settings");
  await expect(page.getByText(workspaceName, { exact: true })).toBeVisible();
  await expect(page.getByText(displayName, { exact: true })).toBeVisible();
  await expect(page.getByText("Team (0)")).toBeVisible();
  await expect(page.getByText("No integrations are available for this workspace.")).toBeVisible();
  await expect(page.getByText("No supported Google, GitHub, or Microsoft accounts are linked.")).toBeVisible();
  await assertNoFabrication();

  await page.goto("/chat");
  await expect(page.getByPlaceholder("Ask Socrates anything about your project…")).toHaveValue("");
  await page.getByRole("button", { name: /Deep Research/i }).click();
  await expect(page.getByRole("textbox", { name: "Research focus" })).toHaveValue("");
  await expect(page.getByText("0/5 used")).toBeVisible();
  await assertNoFabrication();
});

test("rejected writes never become visible success and remain absent after reload", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ Add Subscription" }).click();
  await page.getByRole("textbox", { name: "Service name" }).fill("Rejected Sentinel Subscription");
  await page.getByRole("spinbutton", { name: "Cost" }).fill("10");
  await page.getByRole("button", { name: "Add Subscription", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("[PERSISTENCE_REJECTED] Write rejected by authoritative backend.");
  await expect(page.getByRole("dialog", { name: "Add Subscription" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("No project subscriptions have been added.")).toBeVisible();
  await expect(page.getByText("Rejected Sentinel Subscription", { exact: true })).toHaveCount(0);

  await page.goto("/timeline");
  await page.getByRole("button", { name: "Add Event" }).click();
  await page.getByRole("textbox", { name: "Event title" }).fill("Rejected Sentinel Timeline Event");
  await page.getByRole("button", { name: "+ Add to timeline" }).click();
  await expect(page.getByRole("alert")).toContainText("Write rejected by authoritative backend.");
  await page.reload();
  await expect(page.getByText("No events match this filter")).toBeVisible();
  await expect(page.getByText("Rejected Sentinel Timeline Event", { exact: true })).toHaveCount(0);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#workspace input").first().fill("Rejected Sentinel Rename");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("[PERSISTENCE_REJECTED] Write rejected by authoritative backend.");
  await expect(page.getByText(workspaceName, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(workspaceName, { exact: true })).toBeVisible();
  await expect(page.getByText("Rejected Sentinel Rename", { exact: true })).toHaveCount(0);

  await page.goto("/memory");
  await page.locator('input[type="file"]').setInputFiles({ name: "rejected-sentinel.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic") });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/v1/projects/${projectId}/documents/upload`) && response.status() === 503),
    page.getByRole("button", { name: "Upload", exact: true }).click(),
  ]);
  await expect(page.getByRole("alert")).toHaveText(/Write rejected by authoritative backend\./);
  await expect(page.getByText("Upload complete")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("No documents uploaded yet. Drag a PDF or DOCX above to get started.")).toBeVisible();
  await expect(page.getByText("rejected-sentinel.pdf", { exact: true })).toHaveCount(0);
});
