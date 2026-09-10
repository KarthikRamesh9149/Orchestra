import { useEffect, useMemo, useRef, useState } from "react";
import {isDesktop,saveDesktopDocument} from '../lib/desktop';
import { useLocation, useParams } from "react-router-dom";
import { useAddSelectionToChat } from "../hooks/useAddSelectionToChat";
import { getDocFileBlob, getDocViewer } from "../lib/api/documents";
import type { DocSection, DocViewerPayload } from "../lib/types";
import { useWorkspaceStore } from "../store/workspaceStore";

export function safeAnchor(hash: string): string | null {
  if (!hash) return null;
  try { return decodeURIComponent(hash.slice(1)); } catch { return null; }
}

function sectionId(section: DocSection) {
  return section.sectionId ?? section.id ?? section.anchorId;
}

function sectionText(section: DocSection) {
  return (section.text ?? section.content ?? "").trim();
}

function sectionTitle(section: DocSection) {
  if (section.headingPath?.length) {
    return section.headingPath.join(" / ");
  }
  if (section.type === "heading") {
    return sectionText(section);
  }
  return section.citationLabel ?? "Document section";
}

function versionStatus(payload: DocViewerPayload | null): string | null {
  const version = payload?.version;
  if (!version) {
    return null;
  }
  if (typeof version === "string") {
    return version;
  }
  return version.status;
}

export function LiveDocViewerPage() {
  const { docId = "" } = useParams();
  const location = useLocation();
  const projectId = useWorkspaceStore((state) => state.activeProjectId);
  const selectionChat = useAddSelectionToChat();
  const [payload, setPayload] = useState<DocViewerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"text" | "pdf">("text");
  const [downloading, setDownloading] = useState(false);
  const downloadRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);
    setDownloading(false);
    if (!projectId) return;
    void getDocViewer(projectId, docId)
      .then((nextPayload) => {
        if (!cancelled) {
          setPayload(nextPayload);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not open document.");
      });
    return () => {
      cancelled = true;
      downloadRequest.current?.abort();
    };
  }, [docId, projectId]);

  useEffect(() => {
    if (!payload || !location.hash) return;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(safeAnchor(location.hash) ?? "");
      target?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [location.hash, payload]);

  const title = payload?.document?.title ?? payload?.title ?? "Uploaded document";
  const status = versionStatus(payload);
  const sections = payload?.sections ?? [];
  const hasExtractedText = sections.some((section) => sectionText(section).length > 0);
  const activeAnchor = safeAnchor(location.hash);
  const isPdf = useMemo(() => {
    const version = payload?.version;
    return typeof version !== "string" && version?.mimeType === "application/pdf";
  }, [payload]);

  const downloadOriginal = async () => {
    if (!projectId || downloading) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloading(true);
    setError(null);
    try {
      if(isDesktop()){await saveDesktopDocument(projectId,docId);return;}
      const blob = await getDocFileBlob(projectId, docId, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const extension = isPdf ? ".pdf" : blob.type.includes("wordprocessingml") ? ".docx" : blob.type.includes("spreadsheetml") ? ".xlsx" : blob.type.includes("csv") ? ".csv" : "";
      link.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}${extension}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The original file could not be downloaded.");
    } finally { if (!controller.signal.aborted) setDownloading(false); }
  };

  return (
    <section
      className="h-full overflow-y-auto bg-bg px-8 py-10"
      onMouseUp={selectionChat.captureSelection}
      onKeyUp={selectionChat.captureSelection}
      onBlur={selectionChat.clearSelectionBubble}
    >
      {selectionChat.bubbleElement}
      <div className="mx-auto max-w-[980px]">
        <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--terracotta-text)]">PROJECT MEMORY</p>
        <h1 className="mt-3 font-sans text-[38px] font-light leading-tight text-[var(--text-default)]">
          {title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-sans text-[13px] text-[var(--text-muted)]">
          <span>Source document view. Socrates citations open back to these uploaded project memory sections.</span>
          {status ? (
            <span className="rounded-full border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {status}
            </span>
          ) : null}
        </div>
        {isPdf ? (
          <div className="mt-6 inline-flex rounded-full border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] p-1">
            {([
              { id: "text" as const, label: "Extracted text" },
              { id: "pdf" as const, label: "Paged extracted text" }
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setViewMode(option.id)}
                className={[
                  "rounded-full px-4 py-2 font-sans text-[12px] transition-colors",
                  viewMode === option.id ? "bg-[#1A1612] text-white" : "text-[var(--text-muted)] hover:bg-[#FAF8F5]"
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {payload ? <button type="button" disabled={downloading} onClick={() => void downloadOriginal()} className="mt-4 rounded-full border border-[var(--border-soft)] px-4 py-2 font-sans text-[12px] text-[var(--text-default)] disabled:opacity-50">{downloading ? "Downloading original…" : "Download original"}</button> : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-xl border border-[#9E3B2E]/20 bg-[var(--bg-card)] px-4 py-3 font-sans text-[13px] text-[var(--red-text)]">
            {error}
          </p>
        ) : null}

        <div className="mt-8 rounded-[16px] border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)]">
          {viewMode === "pdf" && isPdf ? (
            sections.length && hasExtractedText ? (
              <PdfStylePreview sections={sections} activeAnchor={activeAnchor} />
            ) : (
              <EmptyDocumentState loaded={Boolean(payload)} />
            )
          ) : sections.length && hasExtractedText ? (
            <div className="divide-y divide-[rgba(26,22,18,0.08)]">
              {sections.map((section) => {
                const text = sectionText(section);
                if (!text) return null;
                return (
                <article
                  id={section.anchorId}
                  key={sectionId(section)}
                  className={[
                    "scroll-mt-10 px-8 py-7 transition-colors target:bg-[var(--tint-terracotta)]",
                    activeAnchor === section.anchorId
                      ? "bg-[var(--tint-terracotta)] outline outline-2 outline-[#B8543D]/40"
                      : ""
                  ].join(" ")}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {section.pageNumber ? (
                      <span className="rounded-full bg-[var(--bg-inset)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                        Page {section.pageNumber}
                      </span>
                    ) : null}
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--terracotta-text)]">
                      {sectionTitle(section)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap font-sans text-[15px] leading-8 text-[var(--text-default)]">{text}</p>
                </article>
                );
              })}
            </div>
          ) : (
            <EmptyDocumentState loaded={Boolean(payload)} />
          )}
        </div>
      </div>
    </section>
  );
}

function EmptyDocumentState({ loaded }: { loaded: boolean }) {
  return (
    <div className="px-8 py-8">
      <p className="font-sans text-[14px] leading-7 text-[var(--text-muted)]">
        {loaded
          ? "This document is still processing or has no extracted text yet."
          : "Loading the parsed document text..."}
      </p>
    </div>
  );
}

function PdfStylePreview({ sections, activeAnchor }: { sections: DocSection[]; activeAnchor: string | null }) {
  const pages = new Map<string, DocSection[]>();
  for (const section of sections) {
    if (!sectionText(section)) continue;
    const pageKey = section.pageNumber ? String(section.pageNumber) : "Document";
    pages.set(pageKey, [...(pages.get(pageKey) ?? []), section]);
  }

  return (
    <div className="space-y-8 bg-[var(--bg-inset)] px-5 py-8 md:px-10">
      {Array.from(pages.entries()).map(([pageLabel, pageSections], pageIndex) => (
        <article
          key={pageLabel}
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 820px" }}
          className="mx-auto min-h-[820px] max-w-[760px] rounded-sm bg-[var(--bg-card)] px-12 py-12 shadow-[0_16px_45px_rgba(26,22,18,0.16)]"
        >
          <div className="mb-8 flex items-center justify-between border-b border-[rgba(26,22,18,0.08)] pb-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--terracotta-text)]">
              {pageLabel === "Document" ? `Page ${pageIndex + 1}` : `Page ${pageLabel}`}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">Project memory preview</span>
          </div>
          <div className="space-y-7">
            {pageSections.map((section) => {
              const text = sectionText(section);
              return (
                <section
                  id={section.anchorId}
                  key={sectionId(section)}
                  className={[
                    "scroll-mt-10 rounded-md px-2 py-1 transition-colors target:bg-[var(--tint-terracotta)]",
                    activeAnchor === section.anchorId ? "bg-[var(--tint-terracotta)] outline outline-2 outline-[#B8543D]/40" : ""
                  ].join(" ")}
                >
                  <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--terracotta-text)]">
                    {sectionTitle(section)}
                  </p>
                  <p className="whitespace-pre-wrap font-serif text-[16px] leading-8 text-[var(--text-default)]">{text}</p>
                </section>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}
