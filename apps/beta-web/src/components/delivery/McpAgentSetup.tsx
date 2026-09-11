import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clipboard, KeyRound, Plug, ShieldCheck, Trash2 } from "lucide-react";
import { createMcpToken, getMcpReadiness, listMcpTokens, revokeMcpToken, type McpReadiness, type McpToken } from "../../lib/api/mcp";
import {isDesktop} from '../../lib/desktop';
import {DesktopMcpSetup} from './DesktopMcpSetup';

type Agent = "codex" | "claude" | "cursor";

type Props={projectId:string;packId:string;targetAgent:Agent;toast:(message:string,kind:'success'|'error'|'info')=>void};
export function McpAgentSetup(props:Props){return isDesktop()?<DesktopMcpSetup {...props}/>:<HostedMcpAgentSetup {...props}/>;}
function HostedMcpAgentSetup({ projectId, packId, targetAgent, toast }: Props) {
  const [readiness, setReadiness] = useState<McpReadiness | null>(null);
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "create" | `revoke:${string}` | null>("load");
  const [error, setError] = useState<string | null>(null);
  const endpoint = useMemo(() => `${window.location.origin}/v1/mcp`, []);

  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    Promise.all([getMcpReadiness(), listMcpTokens()])
      .then(([nextReadiness, nextTokens]) => {
        if (cancelled) return;
        setReadiness(nextReadiness);
        setTokens(nextTokens.filter((token) => token.projectIds.includes(projectId)));
        setError(null);
      })
      .catch((caught) => { if (!cancelled) setError(messageOf(caught, "MCP setup could not be loaded.")); })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [projectId]);

  const create = async () => {
    if (!readiness?.enabled || busy) return;
    setBusy("create");
    setSecret(null);
    try {
      const created = await createMcpToken({ label: `${agentLabel(targetAgent)} · ${new Date().toLocaleDateString()}`, projectId, includePostflight: readiness.controlledWritesEnabled });
      setSecret(created.token);
      setTokens((current) => [created.tokenRecord, ...current]);
      toast("MCP token created. Copy it now; Orchestra stores only its hash.", "success");
    } catch (caught) {
      toast(messageOf(caught, "MCP token could not be created."), "error");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (tokenId: string) => {
    if (busy) return;
    setBusy(`revoke:${tokenId}`);
    try {
      const updated = await revokeMcpToken(tokenId);
      setTokens((current) => current.map((token) => token.id === tokenId ? updated : token));
      toast("MCP token revoked immediately.", "success");
    } catch (caught) {
      toast(messageOf(caught, "MCP token could not be revoked."), "error");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied.`, "success");
    } catch {
      toast(`${label} could not be copied.`, "error");
    }
  };

  if (busy === "load" && !readiness) return <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-muted)]" role="status">Checking secure MCP readiness…</div>;
  if (error || !readiness) return <div className="mt-3 rounded-lg border border-[rgba(200,74,74,0.3)] bg-[rgba(200,74,74,0.04)] p-3 text-xs text-[#C84A4A]" role="alert">{error ?? "MCP setup is unavailable."}</div>;

  const config = configFor(targetAgent, endpoint);
  return <section className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-3" aria-labelledby="mcp-agent-setup-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2"><Plug size={15} className="mt-0.5 text-[var(--terracotta-text)]" aria-hidden="true" /><div><h3 id="mcp-agent-setup-heading" className="text-xs font-semibold text-[var(--text-default)]">Connect {agentLabel(targetAgent)} to this Preflight</h3><p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">The token is restricted to this project, expires within 30 days, is hashed at rest, and can retrieve pack <span className="font-mono text-[10px]">{packId}</span>.</p></div></div><span className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase ${readiness.enabled ? "bg-[var(--tint-teal)] text-[var(--teal-text)]" : "bg-[rgba(200,74,74,0.08)] text-[#C84A4A]"}`}>{readiness.enabled ? "MCP ready" : "MCP unavailable"}</span></div>
    {!readiness.enabled ? <p className="mt-3 rounded-lg bg-[var(--tint-amber)] p-3 text-[11px] text-[var(--amber-text)]">MCP is safely disabled by the server. No connection token can be created until an operator enables it.</p> : <>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => void create()} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50"><KeyRound size={12} aria-hidden="true" />{busy === "create" ? "Creating…" : `Create ${agentLabel(targetAgent)} token`}</button><button type="button" onClick={() => void copy(config, `${agentLabel(targetAgent)} configuration`)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)]"><Clipboard size={12} aria-hidden="true" />Copy setup</button></div>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-inset)] p-3 font-mono text-[10px] leading-5 text-[var(--text-muted)]">{config}</pre>
      {secret ? <div className="mt-3 rounded-lg border border-[var(--amber-text)]/20 bg-[var(--tint-amber)] p-3"><div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--amber-text)]"><ShieldCheck size={13} aria-hidden="true" />Copy this token now. It will not be shown again.</div><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded bg-[var(--bg-elevated)] px-2 py-2 text-[10px] text-[var(--text-default)]">{secret}</code><button type="button" onClick={() => void copy(secret, "MCP token")} aria-label="Copy MCP token" className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] px-3 text-[var(--text-default)]"><Clipboard size={12} aria-hidden="true" /></button></div></div> : null}
      <p className="mt-3 text-[10px] leading-4 text-[var(--text-muted)]">Set <span className="font-mono">ORCHESTRA_MCP_TOKEN</span> to the one-time token, restart the agent, and ask it to call <span className="font-mono">orchestra.get_context_pack</span> with this project and pack ID. {readiness.controlledWritesEnabled ? "This setup also permits the narrow Postflight evidence tool." : "Postflight recording is currently disabled server-side; all available tools remain read-only."}</p>
    </>}
    {tokens.length ? <div className="mt-3 space-y-2"><p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Project tokens</p>{tokens.slice(0, 8).map((token) => <div key={token.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-inset)] p-2.5"><div><p className="text-[11px] font-medium text-[var(--text-default)]">{token.label}</p><p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">{token.tokenPrefix}… · {token.status} · {token.allowControlledWrites ? "Preflight + Postflight" : "read only"}</p></div>{token.status === "active" ? <button type="button" disabled={Boolean(busy)} onClick={() => void revoke(token.id)} className="inline-flex items-center gap-1 text-[10px] text-[#C84A4A] disabled:opacity-50"><Trash2 size={11} aria-hidden="true" />{busy === `revoke:${token.id}` ? "Revoking…" : "Revoke"}</button> : <CheckCircle2 size={13} className="text-[var(--text-muted)]" aria-label="Revoked" />}</div>)}</div> : null}
  </section>;
}

function agentLabel(agent: Agent) { return agent === "codex" ? "Codex" : agent === "claude" ? "Claude" : "Cursor"; }
function configFor(agent: Agent, endpoint: string) {
  if (agent === "codex") return `[mcp_servers.orchestra]\nurl = "${endpoint}"\nbearer_token_env_var = "ORCHESTRA_MCP_TOKEN"`;
  if (agent === "claude") return `claude mcp add --transport http orchestra ${endpoint} \\\n  --header "Authorization: Bearer $ORCHESTRA_MCP_TOKEN"`;
  return JSON.stringify({ mcpServers: { orchestra: { url: endpoint, headers: { Authorization: "Bearer ${env:ORCHESTRA_MCP_TOKEN}" } } } }, null, 2);
}
function messageOf(value: unknown, fallback: string) { return value instanceof Error && value.message ? value.message : fallback; }
