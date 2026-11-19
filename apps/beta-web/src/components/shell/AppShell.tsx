import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isDesktop, isSharedDesktop } from "../../lib/desktop";
import { NavRail } from "./NavRail";

const areas: Record<string, string> = { dashboard: "Dashboard", chat: "Socrates", socrates: "Socrates", memory: "Project Memory", "truth-inbox": "Truth Inbox", delivery: "Delivery", timeline: "Decision log", settings: "Settings" };

export function AppShell() {
  const { pathname } = useLocation();
  const { activeProject, user } = useAuth();
  const [, route, detail] = pathname.split("/");
  const area = route === "truth-inbox" && detail ? "Change packet" : areas[route];
  const org = activeProject?.organizationName || user?.organization?.name;
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-page)] text-[var(--text-default)]" style={isSharedDesktop() ? { height: "calc(100dvh - 2.25rem)" } : undefined}>
      <NavRail />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="desk-context" aria-label="Workspace context">
          <div>{org && <span>{org}</span>}{activeProject && <span>{activeProject.name}</span>}{area && <span>{area}</span>}</div>
          <small>{isSharedDesktop() ? "Shared workspace" : isDesktop() ? "Local workspace" : "Web workspace"}</small>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden"><Outlet /></div>
      </main>
    </div>
  );
}
