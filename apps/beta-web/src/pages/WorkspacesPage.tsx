import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "../components/ui/AppIcons";
import { SocratesLogo } from "../components/ui/SocratesLogo";
import { useAuth } from "../context/AuthContext";
import type { ProjectSummary } from "../lib/api/auth";
import { prefetchPrimaryRoute } from "../lib/performance/prefetch";
import {isDesktop} from '../lib/desktop';

function projectRole(project: ProjectSummary, userId?: string) {
  return (
    project.projectRole ??
    project.members?.find((member) => member.userId === userId && member.isActive)?.projectRole ??
    "dev"
  );
}

function roleLabel(role: string) {
  if (role === "manager") return "Manager";
  if (role === "client") return "Client";
  return "Dev";
}

export function WorkspacesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, projects, refreshProjects, selectProject, createWorkspace, signOut } = useAuth();
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const state = location.state as { workspaceError?: unknown } | null;
    return typeof state?.workspaceError === "string" ? state.workspaceError : null;
  });

  const sortedProjects = useMemo(() => [...projects], [projects]);
  const canCreateWorkspace = user?.globalRole === "owner" || user?.globalRole === "admin";

  const openWorkspace = async (projectId: string) => {
    if (busyProjectId) return;
    setBusyProjectId(projectId);
    setError(null);
    const target = projects.find((project) => project.id === projectId);
    const optimistic = Boolean(target?.organizationId && target.organizationId === user?.orgId);
    try {
      const selection = selectProject(projectId, { optimistic });
      if (optimistic && target) {
        navigate(projectRole(target, user?.id) === "client" ? "/client-workspace" : "/memory", { replace: true });
      }
      const selected = await selection;
      if (!selected) throw new Error("Workspace access is no longer available.");
      if (!optimistic) {
        navigate(selected.projectRole === "client" ? "/client-workspace" : "/memory", { replace: true });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not open workspace.";
      if (optimistic) navigate("/workspaces", { replace: true, state: { workspaceError: message } });
      setError(message);
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleCreateWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (name.length < 2 || creating) return;
    setCreating(true);
    setError(null);
    try {
      await createWorkspace({ name });
      setNewWorkspaceName("");
      await refreshProjects();
      navigate("/memory", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create workspace.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg px-6 py-10">
      <section className="mx-auto flex w-full max-w-[980px] flex-col gap-8">
        <header className="flex flex-col gap-6 rounded-[24px] border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] px-8 py-8 shadow-[0_18px_60px_rgba(26,22,18,0.06)] md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F7F3EC]">
              <SocratesLogo size={25} className="text-[var(--text-default)]" />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Workspace access</p>
              <h1 className="mt-2 font-sans text-[38px] leading-none text-[var(--text-default)]">Choose a workspace</h1>
              <p className="mt-2 font-sans text-[14px] text-[var(--text-muted)]">
                {isDesktop()?'Local workspaces stay on this Mac. No hosted account is required.':`Signed in as ${user?.email}. Workspaces are shared projects; documents live inside the selected workspace.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => isDesktop()?navigate('/onboarding'):void signOut().catch(caught=>setError(caught instanceof Error?caught.message:'Sign-out was not confirmed. Please retry.'))}
            className="rounded-xl border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] px-4 py-2.5 font-sans text-[13px] text-[var(--text-muted)] transition-colors hover:border-[#B8543D]/40 hover:text-[var(--text-default)]"
          >
            {isDesktop()?'Privacy and setup':'Log out'}
          </button>
        </header>

        {error ? (
          <div className="rounded-xl border border-[#9E3B2E]/20 bg-[#9E3B2E]/5 px-4 py-3">
            <p role="alert" className="font-sans text-[13px] leading-5 text-[var(--red-text)]">{error}</p>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {sortedProjects.map((project, index) => {
            const role = projectRole(project, user?.id);
            return (
              <motion.button
                key={project.id}
                type="button"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: index * 0.03 }}
                onClick={() => void openWorkspace(project.id)}
                onPointerEnter={() => void prefetchPrimaryRoute("/memory", project.id, role === "manager")}
                onFocus={() => void prefetchPrimaryRoute("/memory", project.id, role === "manager")}
                className="group rounded-[18px] border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] p-5 text-left shadow-[0_10px_36px_rgba(26,22,18,0.04)] transition-colors hover:border-[#B8543D]/50 hover:bg-[#FFFDFB]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-sans text-[20px] font-medium text-[var(--text-default)]">{project.name}</p>
                    <p className="mt-2 font-sans text-[13px] leading-6 text-[var(--text-muted)]">
                      Project workspace · {roleLabel(role)} access
                    </p>
                  </div>
                  <span className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#FAF8F5] text-[var(--terracotta-text)] transition-transform group-hover:translate-x-0.5">
                    <ArrowRightIcon className="h-4 w-4" />
                  </span>
                </div>
                {busyProjectId === project.id ? (
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--terracotta-text)]">Opening...</p>
                ) : null}
              </motion.button>
            );
          })}
        </div>

        {canCreateWorkspace ? <form onSubmit={(event) => void handleCreateWorkspace(event)} className="rounded-[20px] border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Create new workspace</p>
          <div className="mt-4 flex flex-col gap-3 md:flex-row">
            <input
              aria-label="New workspace name"
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder={projects.length ? "New project workspace name" : "Create your first project workspace"}
              className="min-h-[48px] flex-1 rounded-xl border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] px-4 font-sans text-[14px] text-[var(--text-default)] outline-none transition-colors focus:border-[#B8543D]"
            />
            <button
              type="submit"
              disabled={newWorkspaceName.trim().length < 2 || creating}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[#1A1612] px-5 font-sans text-[13px] font-medium text-white transition-colors hover:bg-[#2A241F] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create workspace"}
            </button>
          </div>
        </form> : null}
      </section>
    </main>
  );
}
