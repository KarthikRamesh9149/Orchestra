import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createProject,
  clearAuth,
  loadBootstrap,
  joinWorkspace as joinWorkspaceApi,
  loadActiveProject,
  login,
  logout,
  setActiveProject as setActiveProjectApi,
  signup,
  switchWorkspace,
  type AuthUser,
  type JoinWorkspaceInput,
  type ProjectSummary
} from "../lib/api/auth";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useChatStore } from "../store/chatStore";
import { ApiError } from "../lib/api/client";
import { isSharedDesktop } from "../lib/desktop";

type AuthStatus = "loading" | "anonymous" | "authenticated" | "unavailable";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  activeProject: ProjectSummary | null;
  projects: ProjectSummary[];
  error: string | null;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  createAccount: (input: { orgName: string; displayName: string; email: string; password: string; projectName: string }) => Promise<void>;
  joinWorkspace: (input: JoinWorkspaceInput) => Promise<void>;
  createWorkspace: (input: { name: string }) => Promise<ProjectSummary>;
  selectProject: (projectId: string, options?: { optimistic?: boolean }) => Promise<ProjectSummary | null>;
  signOut: () => Promise<void>;
  refreshProject: () => Promise<ProjectSummary | null>;
  refreshProjects: () => Promise<ProjectSummary[]>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !import.meta.env.PROD) return;
    // Load non-critical measurement only after the authenticated UI is mounted.
    void import("../lib/webVitals").then(({ startWebVitals }) => startWebVitals()).catch(() => {});
  }, [status]);

  const refreshProject = useCallback(async () => {
    const { activeProject: nextProject, projects: nextProjects } = await loadActiveProject();
    setProjects(nextProjects);
    setActiveProject(nextProject);
    return nextProject;
  }, []);

  const refreshProjects = useCallback(async () => {
    const { activeProject: nextProject, projects: nextProjects } = await loadActiveProject();
    setProjects(nextProjects);
    setActiveProject(nextProject);
    return nextProjects;
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const workspace = await loadBootstrap();
      const nextProject = workspace.activeProject;
      setProjects(workspace.projects);
      setUser(workspace.user);
      setActiveProject(nextProject);
      setStatus("authenticated");
      setError(null);
    } catch (caught) {
      // An earlier startup belongs to a session that was already replaced.
      // It must not clear or overwrite the newer session's state.
      if (caught instanceof ApiError && caught.code === "session_changed") return;
      setError(caught instanceof Error ? caught.message : "Session expired");
      if (!(caught instanceof ApiError) || ![401, 403].includes(caught.status)) {
        setStatus("unavailable");
        return;
      }
      clearAuth();
      setUser(null);
      setActiveProject(null);
      setProjects([]);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signIn = useCallback(
    async (input: { email: string; password: string }) => {
      setError(null);
      const nextUser = await login({ email: input.email, password: input.password });
      useWorkspaceStore.getState().clearActiveProject();
      setActiveProject(null);
      setUser(nextUser);
      await refreshProjects();
      setStatus("authenticated");
    },
    [refreshProjects]
  );

  const createAccount = useCallback(
    async (input: { orgName: string; displayName: string; email: string; password: string; projectName: string }) => {
      setError(null);
      const nextUser = await signup({
        orgName: input.orgName,
        displayName: input.displayName,
        email: input.email,
        password: input.password
      });
      useWorkspaceStore.getState().clearActiveProject();
      setActiveProject(null);
      setUser(nextUser);
      await createProject({
        name: input.projectName,
        description: "Orchestra Beta project memory workspace"
      });
      await refreshProjects();
      setStatus("authenticated");
    },
    [refreshProjects]
  );

  const joinWorkspace = useCallback(
    async (input: JoinWorkspaceInput) => {
      setError(null);
      const nextUser = await joinWorkspaceApi(input);
      useWorkspaceStore.getState().clearActiveProject();
      setActiveProject(null);
      setUser(nextUser);
      await refreshProjects();
      setStatus("authenticated");
    },
    [refreshProjects]
  );

  const createWorkspace = useCallback(
    async (input: { name: string }) => {
      const created = await createProject({
        name: input.name,
        description: "Orchestra Beta project memory workspace"
      });
      const { project, user: nextUser } = await switchWorkspace(created.id);
      setUser(nextUser);
      setActiveProjectApi(project);
      setActiveProject(project);
      await refreshProjects();
      return project;
    },
    [refreshProjects]
  );

  const selectProject = useCallback(
    async (projectId: string, options?: { optimistic?: boolean }) => {
      const candidate = projects.find((item) => item.id === projectId);
      if (!candidate) return null;

      // A project inside the already-authorized organization can render
      // immediately while the durable session preference is persisted. Cross-
      // organization switches still wait for fresh server cookies so requests
      // can never escape the active tenant boundary.
      const previousProject = activeProject;
      if (options?.optimistic) {
        setActiveProjectApi(candidate);
        setActiveProject(candidate);
      }
      try {
        const { project, user: nextUser } = await switchWorkspace(projectId);
        setUser(nextUser);
        setActiveProjectApi(project);
        setActiveProject(project);
        return project;
      } catch (caught) {
        if (options?.optimistic) {
          if (previousProject) setActiveProjectApi(previousProject);
          else useWorkspaceStore.getState().clearActiveProject();
          setActiveProject(previousProject);
        }
        throw caught;
      }
    },
    [activeProject, projects]
  );

  const signOut = useCallback(async () => {
    let confirmed=false;
    try { await logout(); confirmed=true; } finally {
    if(confirmed||!isSharedDesktop()){
    useWorkspaceStore.getState().clearActiveProject();
    useChatStore.getState().resetContinuity();
    setUser(null);
    setActiveProject(null);
    setProjects([]);
    setStatus("anonymous");
    }
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      activeProject,
      projects,
      error,
      signIn,
      createAccount,
      joinWorkspace,
      createWorkspace,
      selectProject,
      signOut,
      refreshProject,
      refreshProjects
    }),
    [activeProject, createAccount, createWorkspace, error, joinWorkspace, projects, refreshProject, refreshProjects, selectProject, signIn, signOut, status, user]
  );

  return <AuthContext.Provider value={value}>{status === "unavailable" ? (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 py-10">
      <p role="alert">{error || "Orchestra is temporarily unavailable. Your session has not been cleared."}</p>
      <button type="button" onClick={() => { setStatus("loading"); void bootstrap(); }}>Retry connection</button>
    </main>
  ) : children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
