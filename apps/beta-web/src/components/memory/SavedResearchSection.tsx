import { ExternalLink, FileText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listSavedResearch, type SavedResearchPage } from "../../lib/api/research";
import type { ProjectContextEntry } from "../../lib/api";
import { ApiError } from "../../lib/api/client";

type SavedResearchState =
  | { status: "loading"; items: ProjectContextEntry[]; page: number; meta: SavedResearchPage["meta"] | null }
  | { status: "ready"; items: ProjectContextEntry[]; page: number; meta: SavedResearchPage["meta"] }
  | { status: "error"; items: ProjectContextEntry[]; page: number; meta: SavedResearchPage["meta"] | null; errorMessage: string; errorCode?: string };

const initialState: SavedResearchState = { status: "loading", items: [], page: 1, meta: null };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function SavedResearchSection({ projectId }: { projectId?: string }) {
  const [state, setState] = useState<SavedResearchState>(initialState);
  const controllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const loadPage = useCallback(async (page: number, append: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;

    if (!projectId) {
      setState({ status: "ready", items: [], page: 1, meta: { page: 1, pageSize: 10, totalCount: 0, totalPages: 0 } });
      return;
    }

    setState((current) => ({
      status: "loading",
      items: append ? current.items : [],
      page,
      meta: append ? current.meta : null,
    }));

    try {
      const result = await listSavedResearch(projectId, page, controller.signal);
      if (request !== requestRef.current || controller.signal.aborted) return;

      // The tag narrows the server query, but only the save operation's
      // generated provenance qualifies an entry as a saved research report.
      const generated = result.items.filter((entry) => entry.source === "generated");
      setState((current) => ({
        status: "ready",
        items: append
          ? [...current.items, ...generated.filter((entry) => !current.items.some((saved) => saved.id === entry.id))]
          : generated,
        page: result.meta.page,
        meta: result.meta,
      }));
    } catch (error) {
      if (request !== requestRef.current || controller.signal.aborted) return;
      const failure = error instanceof ApiError ? error : null;
      setState((current) => ({
        status: "error",
        items: append ? current.items : [],
        page,
        meta: append ? current.meta : null,
        errorMessage: failure?.message ?? "Saved research could not be loaded. Please retry.",
        errorCode: failure?.code,
      }));
    }
  }, [projectId]);

  useEffect(() => {
    void loadPage(1, false);
    return () => controllerRef.current?.abort();
  }, [loadPage]);

  const canLoadMore = state.meta !== null && state.page < state.meta.totalPages;
  const noGeneratedReportOnThisPage = state.status === "ready" && state.items.length === 0;

  return (
    <section aria-labelledby="saved-research-heading" className="mb-8 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] sm:p-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Saved research</p>
          <h2 id="saved-research-heading" className="mt-1.5 font-sans text-[18px] font-medium text-[var(--text-default)]">Deep Research reports</h2>
          <p className="mt-1.5 max-w-[620px] font-sans text-[13px] leading-relaxed text-[var(--text-muted)]">
            Generated research reports are reference material, not accepted project truth.
          </p>
        </div>
        {state.meta && state.meta.totalCount > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Saved-memory page {state.page} of {state.meta.totalPages}
          </p>
        )}
      </div>

      {state.status === "loading" && state.items.length === 0 && (
        <div className="mt-5 flex items-center gap-2 font-sans text-[13px] text-[var(--text-muted)]">
          <RefreshCw size={15} className="animate-spin text-[var(--terracotta-text)]" /> Loading saved research…
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-5 rounded-lg border border-[rgba(200,74,31,0.22)] bg-[rgba(200,74,31,0.05)] px-4 py-3">
          <p role="alert" className="font-sans text-[13px] text-[var(--text-default)]">{state.errorMessage} Your reports have not been changed.</p>
          {state.errorCode && <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{state.errorCode}</p>}
          <button type="button" onClick={() => void loadPage(state.page, state.items.length > 0)} className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--terracotta-text)] hover:underline">Retry</button>
        </div>
      )}

      {state.items.length > 0 && (
        <ul className="mt-5 flex flex-col gap-3" aria-label="Saved Deep Research reports">
          {state.items.map((entry) => (
            <li key={entry.id}>
              <Link to={`/memory/context/${encodeURIComponent(entry.id)}`} className="group flex items-center justify-between gap-4 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-4 py-3 transition-colors hover:border-[#C84A1F]/40">
                <span className="flex min-w-0 items-center gap-3">
                  <FileText size={17} className="flex-shrink-0 text-[var(--terracotta-text)]" />
                  <span className="min-w-0">
                    <span className="block truncate font-sans text-[14px] font-medium text-[var(--text-default)]">{entry.title}</span>
                    <span className="mt-0.5 block font-sans text-[12px] text-[var(--text-muted)]">Saved {formatDate(entry.createdAt)} · Updated {formatDate(entry.updatedAt)} · Generated report</span>
                  </span>
                </span>
                <ExternalLink size={15} className="flex-shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--terracotta-text)]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {noGeneratedReportOnThisPage && (
        <p className="mt-5 font-sans text-[13px] text-[var(--text-muted)]">
          {canLoadMore ? "No generated report appears on this saved-memory page. More pages may contain saved research." : "No generated research reports have been saved in this workspace yet."}
        </p>
      )}

      {canLoadMore && state.status !== "error" && (
        <button type="button" disabled={state.status === "loading"} onClick={() => void loadPage(state.page + 1, true)} className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--terracotta-text)] hover:underline disabled:cursor-wait disabled:opacity-60">
          {state.status === "loading" ? "Loading…" : "Load more saved research"}
        </button>
      )}
    </section>
  );
}
