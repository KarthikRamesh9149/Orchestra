import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Code2,
  Copy,
  Globe,
  Lock,
  Mic,
  Plug,
  RefreshCw,
  Shield,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BiLogoMicrosoftTeams } from "react-icons/bi";
import {
  SiClickup,
  SiGithub,
  SiGoogle,
  SiGooglecalendar,
  SiGoogledrive,
  SiGmail,
  SiNotion,
  SiSlack,
  SiZoho,
} from "react-icons/si";

import { useAuth } from "../context/AuthContext";
import { isDesktop } from "../lib/desktop";
import { OperationalStateNotice } from "../components/ui/OperationalStateNotice";
import { useThemeStore } from "../store/themeStore";
import { safeExternalUrl } from "../lib/socratesPresentation";
import {
  connectIntegration,
  changePassword,
  createVsCodePairing,
  disconnectIntegration,
  getAppearancePreference,
  getIntegrationsList,
  getLinkedAccounts,
  getMembersList,
  getProfile,
  getSessions,
  getWorkspace,
  inviteMember,
  listWorkspaceInvites,
  loadOperationalState,
  removeMember,
  requestEmailVerification,
  revokeWorkspaceInvite,
  revokeAllOtherSessions,
  revokeUserSession,
  revokeVsCodeConnector,
  syncIntegration,
  updateMemberRole,
  updateAppearancePreference,
  updateWorkspace,
  setTruthApprover,
  type OperationalState,
} from "../lib/api/settings";
import { ApiError } from "../lib/api/client";
import type { Integration, Member, MemberRole, Workspace as IntWorkspace, WorkspaceInvite } from "../lib/types/integrations";
import type { LinkedAccount, Session, User } from "../lib/types/profile";
import { useToastStore } from "../components/ui/Toaster";

// ─── Constants ────────────────────────────────────────────────────────────────

const CARD = "rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)]";
const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]";
const EYEBROW_MUTED = "font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]";

function mutationErrorLabel(caught: unknown) {
  if (caught instanceof ApiError) return `[${caught.code}] ${caught.message}`;
  return caught instanceof Error ? caught.message : "The operation failed.";
}

// ─── Integration icon ─────────────────────────────────────────────────────────

function IntegrationIcon({ kind }: { kind: Integration["kind"] }) {
  const configs: Record<Integration["kind"], { bg: string; color: string; icon: React.ReactNode }> = {
    vscode: { bg: "rgba(0,122,204,0.08)", color: "#007ACC", icon: <Code2 size={18} strokeWidth={1.8} /> },
    slack: { bg: "rgba(74,21,75,0.06)", color: "#4A154B", icon: <SiSlack size={16} /> },
    github: { bg: "rgba(26,22,18,0.06)", color: "var(--text-default)", icon: <SiGithub size={17} /> },
    calendar: { bg: "rgba(66,133,244,0.08)", color: "#4285F4", icon: <SiGooglecalendar size={16} /> },
    drive: { bg: "rgba(31,164,99,0.08)", color: "#1FA463", icon: <SiGoogledrive size={16} /> },
    gmail: { bg: "rgba(234,67,53,0.08)", color: "#EA4335", icon: <SiGmail size={16} /> },
    clickup: { bg: "rgba(123,63,242,0.08)", color: "#7B3FF2", icon: <SiClickup size={16} /> },
    granola: { bg: "rgba(229,166,99,0.1)", color: "#C88A3F", icon: <Mic size={18} strokeWidth={1.8} /> },
    fireflies: { bg: "rgba(200,74,31,0.08)", color: "#C84A1F", icon: <Mic size={18} strokeWidth={1.8} /> },
    zoho: { bg: "rgba(200,32,46,0.07)", color: "#C8202E", icon: <SiZoho size={16} /> },
    notion: { bg: "rgba(26,22,18,0.06)", color: "var(--text-default)", icon: <SiNotion size={17} /> },
    teams: { bg: "rgba(98,100,167,0.1)", color: "#6264A7", icon: <BiLogoMicrosoftTeams size={19} /> },
    generic: { bg: "var(--bg-inset)", color: "var(--text-muted)", icon: <Plug size={18} strokeWidth={1.8} /> },
  };
  const { bg, color, icon } = configs[kind] ?? configs.generic;
  return (
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: bg, color }}>
      {icon}
    </div>
  );
}

// ─── Integrations section ─────────────────────────────────────────────────────

function IntegrationsSection() {
  const { activeProject } = useAuth();
  const projectId = activeProject?.id;
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [integrationState, setIntegrationState] = useState<OperationalState<Integration[]>>({ state: "loading" });
  const [connecting, setConnecting] = useState<string | null>(null);
  const { add: showToast } = useToastStore();

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const state = await loadOperationalState(() => getIntegrationsList(projectId), (list) => list.length === 0);
    setIntegrationState(state);
    if (state.state === "ready" || state.state === "empty") setIntegrations(state.data);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setIntegrationState({ state: "loading" });
    void (async () => {
      if (projectId) {
        const state = await loadOperationalState(() => getIntegrationsList(projectId), (list) => list.length === 0);
        if (active) {
          setIntegrationState(state);
          if (state.state === "ready" || state.state === "empty") setIntegrations(state.data);
        }
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  const handleConnect = async (intg: Integration) => {
    if (!projectId || !intg.capabilities.canConnect) return;
    const operation = `${intg.id}:connect`;
    setConnecting(operation);
    try {
      if (intg.kind === "vscode") {
        await createVsCodePairing(projectId);
        await refresh();
        showToast("VS Code pairing started — see Memory to pair.", "success");
      } else {
        const result = await connectIntegration(projectId, intg.id);
        const url = safeExternalUrl(result.redirectUrl ?? result.authorizationUrl);
        if (url) {
          window.location.href = url;
          return;
        }
        if (result.redirectUrl || result.authorizationUrl) {
          throw new Error("The integration returned an unsafe redirect URL.");
        }
        await refresh();
        showToast(`${intg.name} connected`, "success");
      }
    } catch (err) {
      showToast(mutationErrorLabel(err), "error");
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (intg: Integration) => {
    if (!projectId || !intg.capabilities.canDisconnect) return;
    if (!window.confirm(`Disconnect ${intg.name}? Existing evidence will remain, but future syncs will stop.`)) return;
    const operation = `${intg.id}:disconnect`;
    setConnecting(operation);
    try {
      if (intg.kind === "vscode") {
        await revokeVsCodeConnector(projectId);
      } else {
        await disconnectIntegration(projectId, intg.id, intg.connectorId);
      }
      await refresh();
      showToast(`${intg.name} disconnected`, "success");
    } catch (err) {
      showToast(mutationErrorLabel(err), "error");
    } finally {
      setConnecting(null);
    }
  };

  const handleSync = async (intg: Integration) => {
    if (!projectId || !intg.capabilities.canSync) return;
    const operation = `${intg.id}:sync`;
    setConnecting(operation);
    try {
      await syncIntegration(projectId, intg.id, intg.connectorId);
      await refresh();
      showToast(`${intg.name} sync started`, "success");
    } catch (err) {
      showToast(mutationErrorLabel(err), "error");
    } finally {
      setConnecting(null);
    }
  };

  return (
    <section id="integrations">
      <p className={`${EYEBROW} mb-4`}>Integrations</p>
      {integrationState.state === "loading" ? (
        <p className="font-mono text-[11px] text-[var(--text-faint)]">Loading integrations…</p>
      ) : integrationState.state !== "ready" ? (
        <OperationalStateNotice value={integrationState} onRetry={() => void refresh()} emptyMessage="No integrations are available for this workspace." />
      ) : (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {integrations.map((intg) => (
          <div key={intg.id} className={`${CARD} p-4`}>
            <div className="flex items-start gap-3">
              <IntegrationIcon kind={intg.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-sans text-[13px] font-medium text-[var(--text-default)]">{intg.name}</p>
                  <span
                    className="flex-shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]"
                    style={
                      intg.status === "connected"
                        ? { background: "rgba(42,157,143,0.08)", color: "var(--teal-text)" }
                        : { background: "var(--bg-inset)", color: "var(--text-faint)" }
                    }
                  >
                    {intg.status === "connected" ? "connected" : intg.status === "available" ? "available" : intg.status === "needs_attention" ? "needs attention" : "unavailable"}
                  </span>
                </div>
                <p className="mt-1 font-sans text-[11px] leading-relaxed text-[var(--text-muted)]">{intg.description}</p>
                {intg.meta && (
                  <p className="mt-1.5 font-mono text-[10px] text-[var(--text-faint)]">{intg.meta}</p>
                )}
                {intg.disclaimer && intg.status !== "connected" && (
                  <p className="mt-1.5 font-sans text-[10px] italic text-[var(--text-faint)]">{intg.disclaimer}</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-4">
              {intg.capabilities.canSync && (
                <button
                  type="button"
                  aria-label={`Sync ${intg.name}`}
                  onClick={() => void handleSync(intg)}
                  disabled={connecting !== null}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--terracotta-text)] transition-opacity disabled:opacity-50 hover:opacity-80"
                >
                  {connecting === `${intg.id}:sync` && <RefreshCw size={10} className="animate-spin" />}
                  Sync
                </button>
              )}
              {intg.capabilities.canDisconnect && (
                <button
                  type="button"
                  aria-label={`Disconnect ${intg.name}`}
                  onClick={() => void handleDisconnect(intg)}
                  disabled={connecting !== null}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] transition-colors disabled:opacity-50 hover:text-[#C84A4A]"
                >
                  {connecting === `${intg.id}:disconnect` && <RefreshCw size={10} className="animate-spin" />}
                  Disconnect
                </button>
              )}
              {intg.capabilities.canConnect && (
                <button
                  type="button"
                  aria-label={`Connect ${intg.name}`}
                  onClick={() => void handleConnect(intg)}
                  disabled={connecting !== null}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--terracotta-text)] transition-opacity disabled:opacity-50 hover:opacity-80"
                >
                  {connecting === `${intg.id}:connect` && <RefreshCw size={10} className="animate-spin" />}
                  Connect
                </button>
              )}
              {!intg.capabilities.canConnect && !intg.capabilities.canSync && !intg.capabilities.canDisconnect && (
                <button
                  type="button"
                  aria-label={`${intg.name} unavailable`}
                  disabled
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)] opacity-60"
                >
                  Unavailable
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
    </section>
  );
}

// ─── Workspace section ────────────────────────────────────────────────────────

function WorkspaceSection() {
  const { activeProject, refreshProject } = useAuth();
  const projectId = activeProject?.id;
  const canManage = activeProject?.projectRole === "manager";
  const [workspace, setWorkspace] = useState<IntWorkspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [latestInvite, setLatestInvite] = useState<WorkspaceInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<OperationalState<never> | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("dev");
  const [inviteCanApprove, setInviteCanApprove] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const { add: showToast } = useToastStore();

  const refreshTeam = useCallback(async () => {
    if (!projectId) return;
    const [list, inviteList] = await Promise.all([
      getMembersList(projectId),
      canManage && !isDesktop() ? listWorkspaceInvites(projectId) : Promise.resolve([]),
    ]);
    setMembers(list);
    setInvites(inviteList);
  }, [canManage, projectId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        if (projectId) {
          const [ws, list, inviteList] = await Promise.all([
            getWorkspace(projectId),
            getMembersList(projectId),
            canManage && !isDesktop() ? listWorkspaceInvites(projectId) : Promise.resolve([]),
          ]);
          if (active) {
            setWorkspace(ws);
            setNameValue(ws.name);
            setMembers(list);
            setInvites(inviteList);
          }
        }
      } catch (caught) {
        if (active) {
          const state = await loadOperationalState<never>(async () => { throw caught; }, () => false);
          if (state.state !== "loading" && state.state !== "ready" && state.state !== "empty") setWorkspaceError(state);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canManage, projectId]);

  const handleNameSave = async () => {
    if (!workspace || !projectId || !canManage || nameValue.trim().length < 2) return;
    setMutating("workspace-name");
    setMutationError(null);
    try {
      const saved = await updateWorkspace(projectId, { name: nameValue.trim() });
      setWorkspace(saved);
      setNameValue(saved.name);
      await refreshProject();
      setEditingName(false);
      showToast("Workspace name updated", "success");
    } catch (caught) {
      setNameValue(workspace.name);
      setEditingName(false);
      setMutationError(mutationErrorLabel(caught));
    } finally {
      setMutating(null);
    }
  };

  const handleCopySlug = () => {
    if (!workspace) return;
    navigator.clipboard?.writeText(workspace.slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleInvite = async () => {
    if (!projectId || !canManage || !inviteEmail.trim()) return;
    const email = inviteEmail.trim();
    setMutating("invite");
    setMutationError(null);
    try {
      const invite = await inviteMember(projectId, email, inviteRole, inviteRole === "dev" && inviteCanApprove);
      setLatestInvite(invite);
      setInviteEmail("");
      setInviteCanApprove(false);
      setShowInvite(false);
      await refreshTeam();
      showToast(invite.emailDeliveryStatus === "sent" ? `Secure invitation emailed to ${email}` : `Invitation created for ${email}; manual delivery is required`, invite.emailDeliveryStatus === "sent" ? "success" : "info");
    } catch (caught) {
      setMutationError(mutationErrorLabel(caught));
    } finally {
      setMutating(null);
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!projectId || !canManage || !window.confirm(`Remove ${name} from this workspace?`)) return;
    setMutating(id);
    setMutationError(null);
    try {
      await removeMember(projectId, id);
      await refreshTeam();
      showToast(`${name} removed`, "success");
    } catch (caught) {
      setMutationError(mutationErrorLabel(caught));
    } finally {
      setMutating(null);
    }
  };

  const handleRoleChange = async (member: Member, role: MemberRole) => {
    if (!projectId || !canManage || role === member.role) return;
    if (!window.confirm(`Change ${member.name}'s role from ${member.role} to ${role}?`)) return;
    setMutating(member.id);
    setMutationError(null);
    try {
      await updateMemberRole(projectId, member.id, role);
      await refreshTeam();
      showToast("Role updated", "success");
    } catch (caught) {
      setMutationError(mutationErrorLabel(caught));
    } finally {
      setMutating(null);
    }
  };

  const handleTruthApprover = async (member: Member) => {
    if (!projectId || !canManage || member.role !== "dev") return;
    const next = !member.canApproveTruthChanges;
    if (!window.confirm(`${next ? "Grant" : "Revoke"} truth-approval authority for ${member.name}?`)) return;
    setMutating(member.id);
    setMutationError(null);
    try {
      await setTruthApprover(projectId, member.id, next);
      await refreshTeam();
      showToast(next ? "Truth approver granted" : "Truth approver revoked", "success");
    } catch (caught) {
      setMutationError(mutationErrorLabel(caught));
    } finally {
      setMutating(null);
    }
  };

  const handleRevokeInvite = async (invite: WorkspaceInvite) => {
    if (!projectId || !canManage || !window.confirm(`Revoke the invite for ${invite.invitedEmail}?`)) return;
    setMutating(invite.id);
    setMutationError(null);
    try {
      await revokeWorkspaceInvite(projectId, invite.id);
      if (latestInvite?.id === invite.id) setLatestInvite(null);
      await refreshTeam();
      showToast("Invite revoked", "success");
    } catch (caught) {
      setMutationError(mutationErrorLabel(caught));
    } finally {
      setMutating(null);
    }
  };

  if (loading) {
    return (
      <section>
        <p className={`${EYEBROW} mb-4`}>Workspace</p>
        <p className="font-mono text-[11px] text-[var(--text-faint)]">Loading workspace…</p>
      </section>
    );
  }

  if (!workspace) {
    return (
      <section>
        <p className={`${EYEBROW} mb-4`}>Workspace</p>
        {workspaceError ? <OperationalStateNotice value={workspaceError} /> : null}
      </section>
    );
  }

  return (
    <section id="workspace">
      <p className={`${EYEBROW} mb-4`}>Workspace</p>
      <div className={`${CARD} p-6`}>
        {/* Name */}
        <div className="flex items-center gap-3">
          {editingName ? (
            <input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="flex-1 rounded-lg border border-[var(--terracotta)] bg-[var(--bg-page)] px-3 py-2 font-sans text-[14px] text-[var(--text-default)] outline-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleNameSave();
                if (e.key === "Escape") {
                  setNameValue(workspace.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <p className="flex-1 font-sans text-[16px] font-medium text-[var(--text-default)]">{workspace.name}</p>
          )}
          {editingName ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => { setNameValue(workspace.name); setEditingName(false); }} className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Cancel</button>
              <button type="button" disabled={mutating === "workspace-name" || nameValue.trim().length < 2} onClick={() => void handleNameSave()} className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--terracotta-text)] disabled:opacity-40">{mutating === "workspace-name" ? "Saving…" : "Save"}</button>
            </div>
          ) : canManage ? (
            <button type="button" onClick={() => setEditingName(true)} className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--terracotta-text)]">Edit</button>
          ) : null}
        </div>

        {/* Slug */}
        <div className="mt-3 flex items-center gap-2">
          <Globe size={12} strokeWidth={1.7} style={{ color: "var(--text-faint)" }} />
          <span className="font-mono text-[11px] text-[var(--text-faint)]">{workspace.slug}</span>
          <button type="button" aria-label={copied ? "Workspace slug copied" : "Copy workspace slug"} onClick={handleCopySlug} className="ml-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text-default)]">
            {copied ? <Check size={11} strokeWidth={2} className="text-[var(--teal-text)]" /> : <Copy size={11} strokeWidth={1.7} />}
          </button>
          <span className="ml-auto rounded-full bg-[var(--tint-terracotta)] px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--terracotta-text)]">
            {workspace.plan}
          </span>
        </div>

        {/* Divider */}
        <div className="my-5 h-px bg-[var(--border-divider)]" />

        {/* Members */}
        {mutationError && <p role="alert" className="mb-4 rounded-lg border border-[#C84A1F]/30 bg-[#C84A1F]/5 px-3 py-2 font-mono text-[10px] text-[var(--terracotta-text)]">{mutationError}</p>}

        <div className="flex items-center justify-between mb-3">
          <p className={EYEBROW_MUTED}>Team ({members.length})</p>
          {canManage && <button type="button" disabled={isDesktop()} title={isDesktop()?"Invitations require a shared workspace, not a local installation.":undefined} onClick={() => setShowInvite(!showInvite)} className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--terracotta-text)] hover:opacity-80">
            <UserPlus size={11} strokeWidth={1.8} /> Invite
          </button>}
        </div>

        <AnimatePresence>
          {showInvite && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-page)] p-3 sm:grid-cols-[1fr_auto]">
                <input
                  aria-label="Invite email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@example.com"
                  type="email"
                  className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 font-sans text-[12px] text-[var(--text-default)] outline-none focus:border-[#C84A1F]"
                />
                <select aria-label="Invite role" value={inviteRole} onChange={(event) => { const role = event.target.value as MemberRole; setInviteRole(role); if (role !== "dev") setInviteCanApprove(false); }} className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 font-mono text-[10px] uppercase text-[var(--text-default)]">
                  <option value="manager">Manager</option>
                  <option value="dev">Developer</option>
                  <option value="client">Client</option>
                </select>
                {inviteRole === "dev" && <label className="flex items-center gap-2 font-sans text-[11px] text-[var(--text-muted)] sm:col-span-2"><input type="checkbox" checked={inviteCanApprove} onChange={(event) => setInviteCanApprove(event.target.checked)} /> Allow truth approval</label>}
                <button type="button" disabled={mutating === "invite" || !inviteEmail.trim()} onClick={() => void handleInvite()} className="rounded-lg bg-[#C84A1F] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white hover:opacity-90 disabled:opacity-40 sm:col-start-2">
                  {mutating === "invite" ? "Creating…" : "Create invite"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full font-sans text-[10px] font-medium text-white" style={{ background: m.avatarColor }}>
                {m.initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-sans text-[12px] font-medium text-[var(--text-default)]">{m.name}</p>
                <p className="font-mono text-[10px] text-[var(--text-faint)]">{m.email}</p>
              </div>
              <select
                aria-label={`Role for ${m.name}`}
                value={m.role}
                onChange={(e) => void handleRoleChange(m, e.target.value as MemberRole)}
                disabled={!canManage || m.isCurrentUser || mutating === m.id}
                className="font-mono text-[10px] uppercase text-[var(--text-muted)] bg-transparent border-0 outline-none cursor-pointer disabled:cursor-default"
              >
                <option value="manager">Manager</option>
                <option value="dev">Developer</option>
                <option value="client">Client</option>
              </select>
              {m.canApproveTruthChanges && <span className="rounded-full bg-[#2A9D8F]/10 px-2 py-1 font-mono text-[8px] uppercase text-[var(--teal-text)]">Truth approver</span>}
              {canManage && m.role === "dev" && <button type="button" disabled={mutating === m.id} onClick={() => void handleTruthApprover(m)} className="font-mono text-[8px] uppercase text-[var(--text-muted)] hover:text-[var(--terracotta-text)]">{m.canApproveTruthChanges ? "Revoke approval" : "Grant approval"}</button>}
              {canManage && !m.isCurrentUser && (
                <button aria-label={`Remove ${m.name}`} type="button" disabled={mutating === m.id} onClick={() => void handleRemove(m.id, m.name)} className="text-[var(--text-faint)] transition-colors hover:text-[#C84A4A] disabled:opacity-40">
                  <X size={13} strokeWidth={1.7} />
                </button>
              )}
            </div>
          ))}
        </div>

        {latestInvite?.code && <div className="mt-4 rounded-lg border border-[#2A9D8F]/30 bg-[#2A9D8F]/5 p-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--teal-text)]">Six-character activation code — shown in full once</p>
          <div className="mt-2 flex items-center gap-2"><code className="flex-1 break-all text-[12px] text-[var(--text-default)]">{latestInvite.code}</code><button type="button" onClick={() => navigator.clipboard?.writeText(latestInvite.code!)} className="font-mono text-[9px] uppercase text-[var(--terracotta-text)]">Copy</button></div>
          <p className="mt-2 font-sans text-[11px] text-[var(--text-muted)]">{latestInvite.emailDeliveryStatus === "sent" ? `Sent securely to ${latestInvite.invitedEmail} from the connected Gmail account. The email also contains a stronger one-time activation link.` : `Email was not sent (${latestInvite.emailDeliveryError ?? latestInvite.emailDeliveryStatus}). Share this email-bound code securely with ${latestInvite.invitedEmail}, or reconnect Gmail with send permission and create a new invite.`}</p>
        </div>}

        {canManage && invites.length > 0 && <div className="mt-5 border-t border-[var(--border-divider)] pt-4">
          <p className={`${EYEBROW_MUTED} mb-2`}>Invitation status</p>
          <div className="flex flex-col gap-2">{invites.map((invite) => <div key={invite.id} className="flex items-center gap-2 text-[10px]">
            <span className="min-w-0 flex-1 truncate font-sans text-[var(--text-default)]">{invite.invitedEmail}</span>
            <span className="font-mono uppercase text-[var(--text-muted)]">{invite.projectRole}</span>
            <span className="font-mono uppercase text-[var(--text-muted)]">{invite.state}</span>
            <span className="font-mono uppercase text-[var(--text-muted)]">email {invite.emailDeliveryStatus}</span>
            <span className="font-mono text-[var(--text-faint)]">{invite.codePrefix}…</span>
            {invite.state === "pending" && <button type="button" disabled={mutating === invite.id} onClick={() => void handleRevokeInvite(invite)} className="font-mono uppercase text-[#C84A4A]">Revoke</button>}
          </div>)}</div>
        </div>}
      </div>
    </section>
  );
}

// ─── Account section ──────────────────────────────────────────────────────────

function AccountSection() {
  const { user: authUser, activeProject } = useAuth();
  const { mode: themeMode, setMode } = useThemeStore();
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [linked, setLinked] = useState<LinkedAccount[]>([]);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [sessionMutation, setSessionMutation] = useState<string | null>(null);
  const [appearanceMutation, setAppearanceMutation] = useState(false);
  const [securityMutation, setSecurityMutation] = useState<"verify" | "password" | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const { add: showToast } = useToastStore();

  const refreshSessions = useCallback(async () => {
    const list = await getSessions();
    setSessions(list);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [profile, sessionList, linkedList, appearance] = await Promise.allSettled([
          getProfile(),
          getSessions(),
          getLinkedAccounts(),
          getAppearancePreference(),
        ]);
      if (active) {
        if (profile.status === "fulfilled") setProfileUser(profile.value);
        if (sessionList.status === "fulfilled") setSessions(sessionList.value);
        if (linkedList.status === "fulfilled") setLinked(linkedList.value);
        if (appearance.status === "fulfilled") setMode(appearance.value.theme);
        const failures = [profile, sessionList, linkedList, appearance]
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => mutationErrorLabel(result.reason));
        setAccountError(failures.length > 0 ? failures.join(" · ") : null);
      }
    })();
    return () => { active = false; };
  }, [setMode]);

  const handleRevokeSession = async (id: string) => {
    if (!window.confirm("Revoke this session? The device will need to sign in again.")) return;
    setSessionMutation(id);
    setAccountError(null);
    try {
      await revokeUserSession(id);
      await refreshSessions();
      showToast("Session revoked", "success");
    } catch (caught) {
      setAccountError(mutationErrorLabel(caught));
    } finally {
      setSessionMutation(null);
    }
  };

  const handleRevokeAllOther = async () => {
    if (!window.confirm("Revoke every other session? Those devices will need to sign in again.")) return;
    setSessionMutation("all");
    setAccountError(null);
    try {
      await revokeAllOtherSessions();
      await refreshSessions();
      showToast("Other sessions revoked", "success");
    } catch (caught) {
      setAccountError(mutationErrorLabel(caught));
    } finally {
      setSessionMutation(null);
    }
  };

  const handleAppearanceChange = async (mode: "light" | "dark" | "auto") => {
    if (mode === themeMode || appearanceMutation) return;
    setAppearanceMutation(true);
    setAccountError(null);
    try {
      const saved = await updateAppearancePreference(mode);
      setMode(saved.theme);
      showToast("Appearance preference updated", "success");
    } catch (caught) {
      setAccountError(mutationErrorLabel(caught));
    } finally {
      setAppearanceMutation(false);
    }
  };

  const handleVerification = async () => {
    if (!activeProject?.id || securityMutation) return;
    setSecurityMutation("verify");
    setAccountError(null);
    try {
      const result = await requestEmailVerification(activeProject.id);
      if (result.status === "sent") showToast("Verification email sent from the connected Gmail account.", "success");
      else if (result.status === "already_verified") showToast("Your email is already verified.", "info");
      else setAccountError(`Email could not be sent safely (${result.errorCode ?? result.status}). Reconnect Gmail with send permission and try again.`);
    } catch (caught) {
      setAccountError(mutationErrorLabel(caught));
    } finally {
      setSecurityMutation(null);
    }
  };

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (securityMutation) return;
    if (newPassword !== confirmNewPassword) { setAccountError("New passwords do not match."); return; }
    setSecurityMutation("password");
    setAccountError(null);
    try {
      await changePassword(currentPassword, newPassword);
      showToast("Password changed. All sessions were revoked; sign in again.", "success");
      window.location.assign("/login");
    } catch (caught) {
      setAccountError(mutationErrorLabel(caught));
      setSecurityMutation(null);
    }
  };

  const displayName = profileUser?.name ?? authUser?.displayName ?? "User";
  const displayEmail = isDesktop() ? "Local installation · no hosted account" : profileUser?.email ?? authUser?.email ?? "";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <section>
      <p className={`${EYEBROW} mb-4`}>Account</p>
      <div className={`${CARD} p-6`}>
        {/* Identity */}
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full font-sans text-[15px] font-medium text-white" style={{ background: "#C84A1F" }}>
            {initials}
          </div>
          <div>
            <p className="font-sans text-[15px] font-medium text-[var(--text-default)]">{displayName}</p>
            <p className="font-mono text-[11px] text-[var(--text-muted)]">{displayEmail}</p>
            {profileUser && !isDesktop() ? (
              <div className="mt-1 flex flex-wrap items-center gap-2"><p className={`font-mono text-[9px] uppercase tracking-[0.1em] ${profileUser.emailVerified ? "text-[var(--teal-text)]" : "text-[var(--red-text)]"}`}>{profileUser.emailVerified ? "Email verified" : "Email not verified"}</p>{!profileUser.emailVerified ? <button type="button" disabled={Boolean(securityMutation)} onClick={() => void handleVerification()} className="font-mono text-[9px] uppercase text-[var(--terracotta-text)] disabled:opacity-40">{securityMutation === "verify" ? "Sending…" : "Verify email"}</button> : null}</div>
            ) : null}
          </div>
        </div>

        {accountError ? <p className="mt-4 rounded-lg bg-[#9E3B2E]/5 px-3 py-2 font-sans text-[12px] text-[#9E3B2E]">{accountError}</p> : null}

        <div className="my-5 h-px bg-[var(--border-divider)]" />

        {/* Linked accounts */}
        <p className={`${EYEBROW_MUTED} mb-3`}>Linked Accounts</p>
        {linked.length > 0 ? (
            <div className="flex flex-col gap-2">
              {linked.map((a) => {
                const serviceIcon = a.service === "google"
                  ? <SiGoogle size={14} color="#4285F4" />
                  : a.service === "github"
                  ? <SiGithub size={14} className="github-dark-invert text-[var(--text-default)]" />
                  : <Globe size={14} strokeWidth={1.7} style={{ color: "var(--text-muted)" }} />;

                return (
                  <div key={a.id} className="flex items-center gap-3">
                    {serviceIcon}
                    <span className="flex-1 font-sans text-[12px] text-[var(--text-default)] capitalize">
                      {a.service}
                      {a.accountIdentifier && (
                        <span className="ml-1 font-mono text-[10px] text-[var(--text-faint)]">{a.accountIdentifier}</span>
                      )}
                    </span>
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.12em]"
                      style={{ color: a.connected ? "var(--teal-text)" : "var(--text-faint)" }}
                    >
                      {a.connected ? "Connected" : a.status === "needs_reauth" || a.status === "error" ? "Needs attention" : "Not connected"}
                    </span>
                  </div>
                );
              })}
            </div>
        ) : <p className="font-sans text-[11px] text-[var(--text-faint)]">No supported Google, GitHub, or Microsoft accounts are linked.</p>}

        <div className="my-5 h-px bg-[var(--border-divider)]" />

        {/* Appearance */}
        <p className={`${EYEBROW_MUTED} mb-3`}>Appearance</p>
        <div className="flex gap-2">
          {(["light", "dark", "auto"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={themeMode === m}
              disabled={appearanceMutation}
              onClick={() => void handleAppearanceChange(m)}
              className="flex-1 rounded-lg border py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors"
              style={{
                borderColor: themeMode === m ? "var(--terracotta)" : "var(--border-soft)",
                background: themeMode === m ? "var(--tint-terracotta)" : "var(--bg-page)",
                color: themeMode === m ? "var(--terracotta-text)" : "var(--text-muted)",
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="my-5 h-px bg-[var(--border-divider)]" />

        {/* Security */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Shield size={14} strokeWidth={1.7} />
            <p className={EYEBROW_MUTED}>Security</p>
          </div>
          <div className="flex items-center gap-1.5 text-[var(--text-faint)]">
            <Lock size={11} strokeWidth={1.7} />
            <span className="font-mono text-[10px]">{sessions.length} active session{sessions.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
        {sessions.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-[12px] text-[var(--text-default)]">
                    {s.device}
                    {s.isCurrent && (
                      <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--teal-text)]">This device</span>
                    )}
                  </p>
                  <p className="font-mono text-[10px] text-[var(--text-faint)]">
                    {[s.organizationName, s.location, s.lastActiveAt].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    disabled={sessionMutation !== null}
                    onClick={() => void handleRevokeSession(s.id)}
                    className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] transition-colors hover:text-[#C84A4A] disabled:opacity-40"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {sessions.filter((s) => !s.isCurrent).length > 0 && (
          <button
            type="button"
            disabled={sessionMutation !== null}
            onClick={() => void handleRevokeAllOther()}
            className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#C84A4A] hover:underline disabled:opacity-40"
          >
            Revoke all other sessions
          </button>
        )}

        {isDesktop()?<p className="mt-4 font-sans text-[11px] text-[var(--text-muted)]">This local identity has no account password. Access is protected by your macOS account and credential store. Shared account management belongs to your team server.</p>:<form onSubmit={(event) => void handlePasswordChange(event)} className="mt-4 rounded-lg bg-[var(--bg-inset)] p-3">
          <p className={`${EYEBROW_MUTED} mb-2`}>Change password</p>
          <p className="mb-3 font-sans text-[11px] leading-4 text-[var(--text-muted)]">Email verification is required. A successful change revokes every active session.</p>
          <div className="grid gap-2"><input aria-label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-default)] outline-none" /><input aria-label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password (12+ characters)" className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-default)] outline-none" /><input aria-label="Confirm new password" type="password" autoComplete="new-password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="Confirm new password" className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-default)] outline-none" /></div>
          <button type="submit" disabled={securityMutation !== null || currentPassword.length < 8 || newPassword.length < 12 || confirmNewPassword.length < 12} className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 font-mono text-[10px] uppercase text-[var(--text-default)] disabled:opacity-40">{securityMutation === "password" ? "Changing…" : "Change password"}</button>
        </form>}
      </div>
    </section>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

export function SettingsPage() {
  return (
    <div className="orch-page">
      <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-8 sm:py-8">
        {/* Header */}
        <header className="mb-8">
          <p className={EYEBROW}>Settings</p>
          <h1 className="mt-1.5 font-sans text-[28px] font-medium leading-none tracking-tight text-[var(--text-default)]">
            Settings
          </h1>
          <p className="mt-1.5 font-sans text-[13px] text-[var(--text-muted)]">
            Workspace · Integrations · Account
          </p>
        </header>

        <div className="flex flex-col gap-10">
          <IntegrationsSection />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <WorkspaceSection />
            <AccountSection />
          </div>
        </div>
      </div>
    </div>
  );
}
