const loaders = {
  shell: () => import("../../components/shell/AppShell"),
  login: () => import("../../pages/LoginPage"),
  chat: () => import("../../pages/ChatPage"),
  markdown: () => import("../../components/ui/SocratesMarkdown"),
  dashboard: () => import("../../pages/DashboardPage"),
  memory: () => import("../../pages/MemoryTimelinePage"),
  settings: () => import("../../pages/SettingsPage"),
  inbox: () => import("../../pages/TruthInboxPage"),
  packet: () => import("../../pages/TruthChangePacketPage"),
  delivery: () => import("../../pages/DeliveryPage"),
  workspaces: () => import("../../pages/WorkspacesPage"),
};
type CodeKey = keyof typeof loaders;

export function startupCodeKeys(pathname: string): CodeKey[] {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/login") return ["login"];
  if (path === "/chat" || path.startsWith("/chat/") || path === "/socrates") return ["shell", "chat", "markdown"];
  if (path === "/dashboard") return ["shell", "dashboard"];
  if (path === "/memory" || path === "/timeline") return ["shell", "memory"];
  if (path === "/settings") return ["shell", "settings"];
  if (path === "/truth-inbox") return ["shell", "inbox"];
  if (path.startsWith("/truth-inbox/")) return ["shell", "packet"];
  if (path === "/delivery") return ["shell", "delivery"];
  if (path === "/workspaces") return ["workspaces"];
  return [];
}

/** Download public code only. Components and private data remain auth-gated.
 * Run alongside session bootstrap, not after shell -> page -> Markdown renders.
 */
export async function warmStartupCode(pathname: string, modules: Partial<Record<CodeKey, () => Promise<unknown>>> = loaders): Promise<void> {
  await Promise.allSettled(startupCodeKeys(pathname).map(key => modules[key]?.()));
}
