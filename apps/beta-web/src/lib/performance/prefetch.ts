const warmedRoutes = new Map<string, Promise<void>>();

/**
 * Warms the route chunk and, where the data is safe to reuse briefly, its
 * read-only API payload when a user shows intent to navigate.
 */
export function prefetchPrimaryRoute(route: string, projectId: string, canManage: boolean) {
  const routeKey = route.split("?")[0];
  const key = `${projectId}:${routeKey}`;
  const existing = warmedRoutes.get(key);
  if (existing) return existing;

  const request = prefetch(routeKey, projectId, canManage)
    .catch(() => {
      warmedRoutes.delete(key);
    })
    .finally(() => {
      // The API cache owns freshness. Allow a later intent to re-warm after it
      // expires rather than pinning this promise for the entire browser tab.
      window.setTimeout(() => warmedRoutes.delete(key), 20_000);
    });
  warmedRoutes.set(key, request);
  return request;
}

async function prefetch(route: string, projectId: string, canManage: boolean) {
  if (route === "/dashboard") {
    const api = await import("../api/dashboard");
    await api.getDashboard(projectId);
    return;
  }
  if (route === "/chat") {
    await import("../../pages/ChatPage");
    return;
  }
  if (route === "/memory") {
    const [api] = await Promise.all([import("../api"), import("../../pages/MemoryTimelinePage")]);
    await Promise.all([
      api.getDocs(projectId),
      api.listCommunicationConnectors(projectId),
      api.getCommunicationThreads(projectId),
      api.getCommunicationReadiness(projectId),
    ]);
    return;
  }
  if (route === "/truth-inbox") {
    const [api] = await Promise.all([import("../api/truthInbox"), import("../../pages/TruthInboxPage")]);
    await api.getTruthInbox(projectId, { limit: 30 });
    return;
  }
  if (route === "/delivery") {
    const [api] = await Promise.all([import("../api/delivery"), import("../../pages/DeliveryPage")]);
    await api.getDeliveryOverview(projectId);
    return;
  }
  if (route === "/settings") {
    const [api] = await Promise.all([import("../api/settings"), import("../../pages/SettingsPage")]);
    await Promise.all([
      api.getIntegrationsList(projectId),
      api.getWorkspace(projectId),
      api.getMembersList(projectId),
      canManage ? api.listWorkspaceInvites(projectId) : Promise.resolve([]),
      api.getProfile(),
      api.getSessions(),
      api.getLinkedAccounts(),
      api.getAppearancePreference(),
    ]);
  }
}
