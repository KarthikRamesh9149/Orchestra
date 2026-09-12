import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useChatStore } from "./store/chatStore";
import {isDesktop} from './lib/desktop';
import {SharedServerBanner} from './components/shell/SharedServerBanner';
const DesktopOnboardingPage=lazy(()=>import('./pages/DesktopOnboardingPage').then(module=>({default:module.DesktopOnboardingPage})));

const AppShell = lazy(() => import("./components/shell/AppShell").then((module) => ({ default: module.AppShell })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const WorkspacesPage = lazy(() => import("./pages/WorkspacesPage").then((module) => ({ default: module.WorkspacesPage })));
const LiveDocViewerPage = lazy(() => import("./pages/LiveDocViewerPage").then((module) => ({ default: module.LiveDocViewerPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((module) => ({ default: module.ChatPage })));
const MemoryTimelinePage = lazy(() => import("./pages/MemoryTimelinePage").then((module) => ({ default: module.MemoryTimelinePage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage").then((module) => ({ default: module.OnboardingPage })));
const ClientWorkspacePage = lazy(() => import("./pages/ClientWorkspacePage").then((module) => ({ default: module.ClientWorkspacePage })));
const MemoryContextPage = lazy(() => import("./pages/MemoryContextPage").then((module) => ({ default: module.MemoryContextPage })));
const TruthInboxPage = lazy(() => import("./pages/TruthInboxPage").then((module) => ({ default: module.TruthInboxPage })));
const TruthChangePacketPage = lazy(() => import("./pages/TruthChangePacketPage").then((module) => ({ default: module.TruthChangePacketPage })));
const DeliveryPage = lazy(() => import("./pages/DeliveryPage").then((module) => ({ default: module.DeliveryPage })));

function RouteFallback() {
  return <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]" role="status">Opening…</div>;
}

function Deferred({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function AuthenticatedRoute() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
        <p className="font-sans text-[14px] text-[#78716C]">Loading OrchestraOS...</p>
      </main>
    );
  }
  if (status !== "authenticated") {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

function ProjectRoute() {
  const { status, activeProject } = useAuth();
  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
        <p className="font-sans text-[14px] text-[#78716C]">Loading Orchestra Beta...</p>
      </main>
    );
  }
  if (status !== "authenticated") {
    return <Navigate to="/" replace />;
  }
  if (!activeProject) {
    return <Navigate to="/workspaces" replace />;
  }
  if (activeProject.projectRole === "client") {
    return <Navigate to="/client-workspace" replace />;
  }
  return <Outlet />;
}

function ClientWorkspaceRoute() {
  const { status, activeProject } = useAuth();
  if (status !== "authenticated") return <Navigate to="/" replace />;
  if (!activeProject) return <Navigate to="/workspaces" replace />;
  if (activeProject.projectRole !== "client") return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function LegacyDocRedirect() {
  const { docId = "1" } = useParams();
  return <Navigate to={`/memory/docs/${docId}/view`} replace />;
}

function SocratesRedirect() {
  const { search } = useLocation();
  const activeId = useChatStore((state) => state.activeId);
  return <Navigate to={{ pathname: activeId ? `/chat/${activeId}` : "/chat", search }} replace />;
}

export default function App() {
  return (
    <><SharedServerBanner/>
    <Routes>
      {/* ── Auth ── */}
      <Route path="/" element={<Deferred>{isDesktop()?<DesktopOnboardingPage/>:<LoginPage />}</Deferred>} />
      <Route path="/login" element={<Deferred>{isDesktop()?<DesktopOnboardingPage/>:<LoginPage />}</Deferred>} />

      <Route element={<AuthenticatedRoute />}>
        {isDesktop()?<Route path="/onboarding" element={<Deferred><DesktopOnboardingPage/></Deferred>}/>:null}
        <Route path="/workspaces" element={<Deferred><WorkspacesPage /></Deferred>} />
        <Route path="/workspaces/" element={<Deferred><WorkspacesPage /></Deferred>} />
      </Route>

      <Route element={<ClientWorkspaceRoute />}>
        <Route path="/client-workspace" element={<Deferred><ClientWorkspacePage /></Deferred>} />
      </Route>

      <Route element={<ProjectRoute />}>
        {!isDesktop()?<Route path="/onboarding" element={<Deferred><OnboardingPage /></Deferred>} />:null}
        {!isDesktop()?<Route path="/onboarding/" element={<Deferred><OnboardingPage /></Deferred>} />:null}

        {/* ── Primary routes ── */}
        <Route element={<Deferred><AppShell /></Deferred>}>
          <Route path="/dashboard" element={<Deferred><DashboardPage /></Deferred>} />
          <Route path="/dashboard/" element={<Deferred><DashboardPage /></Deferred>} />

          <Route path="/chat/*" element={<Deferred><ChatPage /></Deferred>} />

          <Route path="/memory" element={<Deferred><MemoryTimelinePage /></Deferred>} />
          <Route path="/memory/" element={<Deferred><MemoryTimelinePage /></Deferred>} />
          <Route path="/memory/docs/:docId/view" element={<Deferred><LiveDocViewerPage /></Deferred>} />
          <Route path="/memory/docs/:docId/view/" element={<Deferred><LiveDocViewerPage /></Deferred>} />
          <Route path="/memory/context/:contextId" element={<Deferred><MemoryContextPage /></Deferred>} />
          <Route path="/memory/context/:contextId/" element={<Deferred><MemoryContextPage /></Deferred>} />

          <Route path="/settings" element={<Deferred><SettingsPage /></Deferred>} />
          <Route path="/settings/" element={<Deferred><SettingsPage /></Deferred>} />
          <Route path="/truth-inbox" element={<Deferred><TruthInboxPage /></Deferred>} />
          <Route path="/truth-inbox/" element={<Deferred><TruthInboxPage /></Deferred>} />
          <Route path="/truth-inbox/:itemId" element={<Deferred><TruthChangePacketPage /></Deferred>} />
          <Route path="/truth-inbox/:itemId/" element={<Deferred><TruthChangePacketPage /></Deferred>} />
          <Route path="/delivery" element={<Deferred><DeliveryPage /></Deferred>} />
          <Route path="/delivery/" element={<Deferred><DeliveryPage /></Deferred>} />

          {/* ── Legacy redirects ── */}
          <Route path="/socrates" element={<SocratesRedirect />} />
          <Route path="/socrates/" element={<SocratesRedirect />} />
          <Route path="/timeline" element={<Deferred><MemoryTimelinePage /></Deferred>} />
          <Route path="/timeline/" element={<Deferred><MemoryTimelinePage /></Deferred>} />
          <Route path="/watchtower" element={<Navigate to="/truth-inbox" replace />} />
          <Route path="/watchtower/" element={<Navigate to="/truth-inbox" replace />} />
          <Route path="/suggestions" element={<Navigate to="/truth-inbox" replace />} />
          <Route path="/suggestions/" element={<Navigate to="/truth-inbox" replace />} />
          <Route path="/github" element={<Navigate to="/dashboard" replace />} />
          <Route path="/github/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/profile" element={<Navigate to="/settings" replace />} />
          <Route path="/profile/" element={<Navigate to="/settings" replace />} />
          <Route path="/connectors" element={<Navigate to="/settings" replace />} />
          <Route path="/connectors/" element={<Navigate to="/settings" replace />} />
          <Route path="/integrations" element={<Navigate to="/settings" replace />} />
          <Route path="/integrations/" element={<Navigate to="/settings" replace />} />
          <Route path="/artifacts" element={<Navigate to="/chat" replace />} />
          <Route path="/artifacts/" element={<Navigate to="/chat" replace />} />
        </Route>
      </Route>

      {/* ── Legacy deep-link redirects ── */}
      <Route path="/projects" element={<Navigate to="/workspaces" replace />} />
      <Route path="/projects/:id" element={<Navigate to="/memory" replace />} />
      <Route path="/projects/:id/memory" element={<Navigate to="/memory" replace />} />
      <Route path="/projects/:id/connectors" element={<Navigate to="/settings" replace />} />
      <Route path="/projects/:id/docs/:docId/view" element={<LegacyDocRedirect />} />
      <Route path="/projects/:id/*" element={<Navigate to="/memory" replace />} />
      <Route path="/requests" element={<Navigate to="/memory" replace />} />
      <Route path="*" element={<Navigate to="/workspaces" replace />} />
    </Routes></>
  );
}
