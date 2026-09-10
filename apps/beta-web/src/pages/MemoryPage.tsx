import { AnimatePresence, motion } from "framer-motion";
import {copyText} from '../lib/clipboard';
import {useToastStore} from '../components/ui/Toaster';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Hash,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiSlack } from "react-icons/si";
import { TbChevronDown } from "react-icons/tb";
import { useNavigate } from "react-router-dom";
import Avatar from "../components/ui/Avatar";
import { OperationalStateNotice } from "../components/ui/OperationalStateNotice";
import { useAuth } from "../context/AuthContext";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";
import { clearApiReadCache } from "../lib/api/client";
import { createDocumentUploadOperationId, reconcileDocumentUpload } from "../lib/api";
import {isDesktop,saveDesktopDocument} from '../lib/desktop';
import {
  archiveDocument,
  connectSlack,
  getCommunicationReadiness,
  getCommunicationThreads,
  getDocs,
  getDocFileBlob,
  loadOperationalState,
  listCommunicationConnectors,
  uploadDoc,
  type CommunicationConnector,
  type CommunicationConnectorReadiness,
  type CommunicationThreadSummary,
  type OperationalState,
} from "../lib/api/memory";
import type { Doc } from "../lib/types";
import { safeExternalUrl } from "../lib/socratesPresentation";

// ─── Types ────────────────────────────────────────────────────────────────────

type MemoryTab = "all" | "source-docs" | "communications";

const SEARCH_PLACEHOLDERS = [
  "Ask anything about project documents or discussions…",
  "What did we decide about auth?",
  "Summarize this week's spec changes",
  "Who owns the assignment module?",
];

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, visible, type = "teal", onClose }: { message: string; visible: boolean; type?: "teal" | "terracotta"; onClose: () => void }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role={type === "terracotta" ? "alert" : "status"}
          aria-live={type === "terracotta" ? "assertive" : "polite"}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="fixed right-6 top-6 z-[600] flex items-center gap-2 rounded-xl px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          style={{ background: type === "teal" ? "var(--tint-teal)" : "var(--tint-red)", color: type === "teal" ? "var(--teal-text)" : "var(--red-text)" }}
        >
          {type === "teal" ? <Check size={13} strokeWidth={2} /> : <X size={13} strokeWidth={2} />}
          <span className="font-sans text-[13px] font-medium">{message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={onClose}><X size={14} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useToast() {
  const [state, setState] = useState({ visible: false, message: "", type: "teal" as "teal" | "terracotta" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = (message: string, type: "teal" | "terracotta" = "teal") => {
    if (timer.current) clearTimeout(timer.current);
    setState({ visible: true, message, type });
    if (type !== "terracotta") timer.current = setTimeout(() => setState((s) => ({ ...s, visible: false })), 6000);
  };
  return { toastState: state, showToast: show, dismissToast: () => setState((s) => ({ ...s, visible: false })) };
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

type UploadState = "idle" | "selected" | "uploading" | "success";

function DropZone({
  onUploaded,
  showToast,
}: {
  onUploaded: (doc: Doc) => void;
  showToast: (msg: string, type?: "teal" | "terracotta") => void;
}) {
  const { activeProject } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState<{ percent: number | null; phase: "uploading" | "processing" } | null>(null);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const uploadOperationRef = useRef<{ projectId: string; operationId: string } | null>(null);
  const activeProjectIdRef = useRef(activeProject?.id ?? null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const setOperation = (value: { projectId: string; operationId: string } | null) => {
    uploadOperationRef.current = value;
  };

  useEffect(() => {
    // Strict Mode intentionally performs setup → cleanup → setup in development.
    // Reset this flag on each setup so the surviving mount can accept results.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadControllerRef.current?.abort();
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const currentProjectId = activeProject?.id ?? null;
    if (activeProjectIdRef.current === currentProjectId) return;
    activeProjectIdRef.current = currentProjectId;
    uploadControllerRef.current?.abort();
    const operation = uploadOperationRef.current;
    if (operation && operation.projectId !== currentProjectId) {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      setSelectedFile(null);
      setOperation(null);
      setNeedsReconciliation(false);
      setUploadProgress(null);
      setUploadState("idle");
    }
  }, [activeProject?.id]);

  const handleFile = (file: File) => {
    if (uploadState === "uploading") {
      showToast("Wait for the current upload to finish or stop it before choosing another file.", "terracotta");
      return;
    }
    const ok = file.name.toLowerCase().endsWith(".pdf") || file.name.toLowerCase().endsWith(".docx");
    if (!ok) { showToast("Only PDF or DOCX files are supported.", "terracotta"); return; }
    if (file.size > 25 * 1024 * 1024) { showToast("File must be under 25 MB.", "terracotta"); return; }
    setSelectedFile(file);
    if (activeProject?.id) setOperation({ projectId: activeProject.id, operationId: createDocumentUploadOperationId() });
    else setOperation(null);
    setNeedsReconciliation(false);
    setUploadState("selected");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const resetSoon = () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setUploadState("idle");
      setSelectedFile(null);
      setOperation(null);
      setNeedsReconciliation(false);
    }, 900);
  };

  const handleUpload = async () => {
    if (!selectedFile || uploadState === "uploading") return;
    const projectId = activeProject?.id;
    if (!projectId) {
      showToast("Select a workspace before uploading.", "terracotta");
      return;
    }
    let operation = uploadOperationRef.current;
    if (!operation || operation.projectId !== projectId) {
      operation = { projectId, operationId: createDocumentUploadOperationId() };
      setOperation(operation);
    }
    setUploadState("uploading");
    setUploadProgress({ percent: 0, phase: "uploading" });
    const controller = new AbortController();
    uploadControllerRef.current = controller;

    try {
      if (needsReconciliation) {
        try {
          const reconciled = await reconcileDocumentUpload(projectId, operation.operationId, controller.signal);
          if (!mountedRef.current || activeProjectIdRef.current !== projectId) return;
          if (controller.signal.aborted) throw controller.signal.reason;
          clearApiReadCache();
          const documents = await getDocs(projectId);
          const completedDocument = documents.find((document) => document.id === reconciled.documentId);
          if (!completedDocument) throw new Error("The upload completed, but its document is not available yet. Refresh Memory before trying again.");
          if (reconciled.status === "failed") {
            onUploaded(completedDocument);
            setUploadState("selected");
            showToast("The file was received but processing failed. Remove the failed document before uploading it again.", "terracotta");
            return;
          }
          setUploadState("success");
          onUploaded(completedDocument);
          showToast(reconciled.status === "ready" ? "Document upload confirmed." : "Document uploaded — processing…");
          resetSoon();
          return;
        } catch (err) {
          const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
          if (!mountedRef.current || activeProjectIdRef.current !== projectId) return;
          if (code !== "upload_operation_not_found") throw err;
          setNeedsReconciliation(false);
        }
      }
      const newDoc = await uploadDoc(projectId, selectedFile, {
        signal: controller.signal,
        operationId: operation.operationId,
        onProgress: ({ percent, phase }) => setUploadProgress({ percent, phase })
      });
      if (!mountedRef.current || activeProjectIdRef.current !== projectId) return;
      if (controller.signal.aborted) throw controller.signal.reason;
      setUploadState("success");
      onUploaded(newDoc);
      showToast("Document uploaded — processing…");
      resetSoon();
    } catch (err) {
      if (!mountedRef.current || activeProjectIdRef.current !== projectId) return;
      setUploadState("selected");
      const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
      setNeedsReconciliation(true);
      showToast(code === "cancelled" || controller.signal.aborted ? "Upload stopped. We will check its status before another upload." : err instanceof Error ? err.message : "Upload failed.", "terracotta");
    } finally {
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
    }
  };

  const formatBytes = (b: number) => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (uploadState !== "uploading") setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className="relative flex h-[148px] flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-all duration-150"
        style={{
          borderColor: isDragging ? "#C84A1F" : uploadState === "success" ? "#2A9D8F" : "var(--border-stronger)",
          background: isDragging ? "var(--tint-terracotta)" : uploadState === "success" ? "rgba(42,157,143,0.04)" : "var(--bg-inset)",
        }}
      >
        {uploadState === "uploading" ? (
          <div className="flex w-full flex-col items-center gap-3 px-3 sm:px-8">
            <RefreshCw size={24} strokeWidth={1.7} className="animate-spin text-[var(--terracotta-text)]" />
            <p className="font-sans text-[13px] font-medium text-[var(--text-default)]">Uploading {selectedFile?.name}</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-soft)]">
              <motion.div
                className="h-full rounded-full bg-[#C84A1F]"
                animate={{ width: uploadProgress?.percent === null || uploadProgress?.percent === undefined ? "100%" : `${uploadProgress.percent}%` }}
                transition={{ ease: "linear", duration: 0.1 }}
              />
            </div>
            <div className="flex items-center gap-3">
              <p role="status" className="font-mono text-[10px] text-[var(--text-muted)]">
                {uploadProgress?.phase === "processing" ? "Upload complete — waiting for processing confirmation…" : `${uploadProgress?.percent ?? 0}% uploaded`}
              </p>
              <button type="button" onClick={() => uploadControllerRef.current?.abort()} className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#C84A1F] hover:underline">
                Stop upload
              </button>
            </div>
            <p className="font-mono text-[9px] text-[var(--text-faint)]">Stopping this browser request may not undo an upload already received by the server.</p>
          </div>
        ) : uploadState === "selected" && selectedFile ? (
          <div className="flex items-center gap-4 px-6">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(200,74,31,0.08)]">
              <FileText size={20} strokeWidth={1.7} className="text-[var(--terracotta-text)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-[14px] font-medium text-[var(--text-default)]">{selectedFile.name}</p>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                {formatBytes(selectedFile.size)} · {selectedFile.name.toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX"}
              </p>
            </div>
            <button type="button" onClick={() => { setSelectedFile(null); setOperation(null); setNeedsReconciliation(false); setUploadState("idle"); }} className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[#C84A4A]">
              Remove ✕
            </button>
          </div>
        ) : uploadState === "success" ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(42,157,143,0.12)]">
              <Check size={20} strokeWidth={2} className="text-[var(--teal-text)]" />
            </div>
            <p className="font-sans text-[13px] font-medium text-[var(--teal-text)]">Upload complete</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <UploadCloud size={28} strokeWidth={1.4} style={{ color: isDragging ? "var(--terracotta-text)" : "var(--text-muted)" }} />
            <p className="font-sans text-[13px] font-medium" style={{ color: isDragging ? "var(--terracotta-text)" : "var(--text-default)" }}>
              Drag and drop your PDF or DOCX here
            </p>
            <p className="font-sans text-[11px] text-[var(--text-muted)]">or</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full border border-[var(--text-default)] bg-transparent px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-default)] transition-colors hover:bg-[var(--bg-inset)]"
            >
              Choose File
            </button>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".pdf,.docx" disabled={uploadState === "uploading"} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      </div>
      <p className="mt-2 text-center font-mono text-[10px] text-[var(--text-faint)]">Max 25 MB · PDF or DOCX only</p>

      {/* Upload button row */}
      <AnimatePresence>
        {uploadState === "selected" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 flex items-center justify-between overflow-hidden"
          >
            <p className="font-mono text-[10px] text-[var(--text-muted)]">Stored as immutable project memory evidence.</p>
            <button
              type="button"
              onClick={() => { void handleUpload(); }}
              className="rounded-full bg-[#C84A1F] px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white transition-opacity hover:opacity-90"
            >
              Upload
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Doc Context Menu ─────────────────────────────────────────────────────────

function DocMenu({ doc, onRemove, onDownload }: { doc: Doc; onRemove: () => void; onDownload: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } }}>
      <button ref={triggerRef} type="button" aria-label={`Open actions for ${doc.name}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--text-default)]">
        <MoreHorizontal size={16} strokeWidth={1.8} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="group" aria-label={`Actions for ${doc.name}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.1 }}
            className="absolute right-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
            {[
              { label: "Open", icon: FileText, action: () => { navigate(`/memory/docs/${doc.id}/view`); setOpen(false); } },
              { label: "Download original", icon: Download, action: () => { onDownload(); setOpen(false); } },
              { label: "Copy doc ID", icon: Copy, action: () => { void copyText(doc.id).then(()=>setOpen(false)).catch(()=>useToastStore.getState().add('Document ID could not be copied.', 'error')); } },
            ].map(({ label, icon: Icon, action }) => (
              <button key={label} type="button" onClick={action} className="flex w-full items-center gap-3 px-4 py-2.5 font-sans text-[13px] text-[var(--text-default)] hover:bg-[var(--bg-inset)]">
                <Icon size={14} strokeWidth={1.7} className="text-[var(--text-muted)]" /> {label}
              </button>
            ))}
            <div className="h-px bg-[#F2EDE6]" />
            <button type="button" onClick={() => { onRemove(); setOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2.5 font-sans text-[13px] text-[#C84A4A] hover:bg-[rgba(200,74,74,0.04)]">
              <X size={14} strokeWidth={1.7} /> Remove from memory
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Doc Card ─────────────────────────────────────────────────────────────────

function DocCard({ doc, onRemove, onDownload }: { doc: Doc; onRemove: (id: string) => Promise<void>; onDownload: (doc: Doc) => Promise<void> }) {
  const navigate = useNavigate();
  const [showConfirm, setShowConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const closeRemoveDialog = () => { if (!removing) setShowConfirm(false); };
  const removeDialogRef = useAccessibleDialog<HTMLDivElement>(closeRemoveDialog, removing, showConfirm);
  const indexed = doc.status === "ready";

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.18 }}
        className="group cursor-pointer rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5 transition-all duration-150 hover:-translate-y-px hover:border-[#D4CABA] hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]"
        onClick={() => navigate(`/memory/docs/${doc.id}/view`)}
      >
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(200,74,31,0.08)]">
            <FileText size={20} strokeWidth={1.7} className="text-[var(--terracotta-text)]" />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <p className="font-sans text-[15px] font-medium text-[var(--text-default)]">{doc.name}</p>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-muted)]">
              <span>{doc.fileName ?? doc.name}</span>
              <span>·</span>
              <span>{doc.uploadedAt}</span>
            </div>
            <p className="mt-2 line-clamp-2 font-sans text-[12px] leading-relaxed text-[var(--text-default)]">{doc.excerpt}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-[var(--text-muted)]">
              <span>{doc.size}</span>
              {doc.pages > 0 && <><span>·</span><span>{doc.pages} pages</span></>}
              <span>·</span>
              <span className="flex items-center gap-1">
                <Avatar seed={doc.uploadedBy} size={14} name={doc.uploadedBy} />
                by {doc.uploadedBy}
              </span>
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {/* Status */}
            {doc.status === "processing" ? (
              <div className="flex items-center gap-1.5 rounded-full bg-[rgba(229,166,99,0.1)] px-2.5 py-1">
                <motion.span className="h-1.5 w-1.5 rounded-full bg-[#E5A663]" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity }} />
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#E5A663]">Processing</span>
              </div>
            ) : doc.status === "partial" ? (
              <span title="Extracted content is available. Some processing, such as semantic indexing, is unavailable or incomplete." className="rounded-full bg-[rgba(200,74,31,0.08)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--terracotta-text)]">Partially processed</span>
            ) : doc.status === "failed" ? (
              <span className="rounded-full bg-[rgba(200,74,31,0.08)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--terracotta-text)]">Failed</span>
            ) : (
              <span className="rounded-full bg-[rgba(42,157,143,0.08)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--teal-text)]">Ready</span>
            )}
            {/* Socrates indexed */}
            {indexed && (
              <div title="Indexed by Socrates" className="flex items-center gap-1 text-[var(--terracotta-text)] opacity-80 hover:opacity-100">
                <Sparkles size={12} strokeWidth={1.8} />
              </div>
            )}
            {/* Menu */}
            <DocMenu doc={doc} onRemove={() => { setRemoveError(null); setShowConfirm(true); }} onDownload={() => { void onDownload(doc); }} />
          </div>
        </div>
      </motion.div>

      {/* Remove confirmation */}
      <AnimatePresence>
        {showConfirm && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center">
            <div className="absolute inset-0 bg-[#1A1714]/40" onClick={closeRemoveDialog} />
            <motion.div ref={removeDialogRef} role="alertdialog" aria-modal="true" aria-labelledby={`remove-document-${doc.id}-title`} aria-describedby={`remove-document-${doc.id}-description`} tabIndex={-1} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="relative z-10 w-full max-w-[400px] rounded-2xl bg-[var(--bg-card)] p-8 shadow-[0_24px_64px_rgba(0,0,0,0.12)]">
              <h2 id={`remove-document-${doc.id}-title`} className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Remove Document</h2>
              <p id={`remove-document-${doc.id}-description`} className="mt-3 font-sans text-[14px] leading-relaxed text-[var(--text-default)]">
                Remove <strong>{doc.name}</strong> from project memory? Socrates will no longer be able to reference it.
              </p>
              {removeError ? <p role="alert" className="mt-3 font-sans text-[12px] text-[var(--terracotta-text)]">{removeError}</p> : null}
              <div className="mt-6 flex items-center justify-end gap-3">
                <button data-dialog-initial-focus type="button" disabled={removing} onClick={() => setShowConfirm(false)} className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-default)] disabled:opacity-50">Cancel</button>
                <button type="button" disabled={removing} onClick={() => {
                  setRemoving(true);
                  setRemoveError(null);
                  void onRemove(doc.id)
                    .then(() => setShowConfirm(false))
                    .catch((error) => setRemoveError(error instanceof Error ? error.message : "Could not remove this document."))
                    .finally(() => setRemoving(false));
                }} className="rounded-full bg-[#C84A4A] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white hover:opacity-90 disabled:opacity-60">
                  {removing ? "Removing…" : "Remove"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Communications Panel ─────────────────────────────────────────────────────

function CommunicationsPanel({
  loading,
  connectors,
  threads,
  onConnect,
  connecting,
  slackReadiness,
}: {
  loading: boolean;
  connectors: CommunicationConnector[];
  threads: CommunicationThreadSummary[];
  onConnect: () => void;
  connecting: boolean;
  slackReadiness: CommunicationConnectorReadiness | null;
}) {
  const navigate = useNavigate();

  const providerLabel = (provider: string) => provider
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const safeProviderUrl = (value?: string | null) => {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <RefreshCw size={22} strokeWidth={1.6} className="animate-spin text-[var(--terracotta-text)]" />
        <p className="font-sans text-[13px] text-[var(--text-muted)]">Loading communications…</p>
      </div>
    );
  }

  // No connectors → connect Slack empty state.
  if (connectors.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <div className="mb-8 flex flex-col items-center gap-3">
              <SiSlack aria-hidden="true" focusable="false" size={32} color="#4A154B" />
          <p className="font-sans text-[20px] font-medium text-[var(--text-default)]">Connect Slack channels</p>
          <p className="max-w-prose text-center font-sans text-[13px] leading-relaxed text-[var(--text-muted)]">
            Connect a Slack workspace to search selected discussions. Orchestra stores synchronized message content and retrieval indexes; the originals remain in Slack.
          </p>
        </div>
        <div className="w-full rounded-xl border border-[rgba(200,74,31,0.2)] bg-[#FBEEE8] px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-sans text-[13px] font-medium text-[var(--text-default)]">No Slack workspace connected yet</p>
              <p className="mt-0.5 font-sans text-[12px] text-[var(--text-muted)]">Authorize Slack to start indexing channel discussions.</p>
            </div>
            {slackReadiness?.readiness.canConnect ? (
              <button
                type="button"
                onClick={onConnect}
                disabled={connecting}
                className="flex flex-shrink-0 items-center gap-2 rounded-full bg-[#C84A1F] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white hover:opacity-90 disabled:opacity-60"
              >
                {connecting ? <RefreshCw size={11} className="animate-spin" /> : null}
                {connecting ? "Connecting…" : "Connect Slack →"}
              </button>
            ) : (
              <button
                type="button"
                aria-label="Slack unavailable"
                disabled
                className="flex-shrink-0 rounded-full bg-[var(--border-soft)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]"
              >
                Unavailable
              </button>
            )}
          </div>
          {!slackReadiness?.readiness.canConnect && (
            <p className="mt-2 text-right font-sans text-[11px] text-[var(--text-muted)]">Slack is not configured by an administrator.</p>
          )}
        </div>
      </div>
    );
  }

  // Has connectors → show connector state + recent threads (read-only).
  return (
    <div className="flex flex-col">
      <div className="mb-6 flex flex-col items-center gap-3">
        <MessageSquare size={32} className="text-[var(--terracotta-text)]" />
        <p className="font-sans text-[20px] font-medium text-[var(--text-default)]">Connected workspaces</p>
        <p className="max-w-prose text-center font-sans text-[13px] leading-relaxed text-[var(--text-muted)]">
          Orchestra stores synchronized content and retrieval indexes from selected sources. Original messages remain in their source workspace.
        </p>
      </div>

      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Connectors</p>
      <div className="mb-6 flex flex-col gap-2">
        {connectors.map((connector) => {
          const connected = connector.status === "connected";
          return (
            <div
              key={connector.id}
              className="flex items-center gap-3 rounded-lg border-l-[3px] bg-[var(--bg-card)] px-4 py-3"
              style={{
                borderLeftColor: connected ? "#2A9D8F" : "#E5A663",
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                borderRight: "1px solid #E8E0D3",
                borderTop: "1px solid #E8E0D3",
                borderBottom: "1px solid #E8E0D3",
              }}
            >
              {connector.provider === "slack"
                ? <SiSlack size={14} color={connected ? "#2A9D8F" : "#8A8378"} />
                : <MessageSquare size={14} color={connected ? "#2A9D8F" : "#8A8378"} />}
              <div className="flex-1">
                <span className="font-mono text-[13px] text-[var(--text-default)]">{connector.accountLabel || providerLabel(connector.provider)}</span>
                <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{providerLabel(connector.provider)}</span>
                {connector.counts ? (
                  <span className="ml-2 font-mono text-[10px] text-[var(--text-muted)]">
                    {connector.counts.threads} threads · {connector.counts.messages} messages
                  </span>
                ) : null}
              </div>
              <span
                className="flex items-center gap-1 font-mono text-[10px]"
                style={{ color: connected ? "var(--teal-text)" : "var(--amber-text)" }}
              >
                {connected ? <Check size={11} strokeWidth={2.5} /> : null}
                {connector.status}
              </span>
            </div>
          );
        })}
      </div>

      {/* Recent threads */}
      {threads.length > 0 && (
        <div className="w-full">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Recent Threads</p>
          <div className="flex flex-col gap-2">
            {threads.map((thread) => {
              const providerUrl = thread.providerOpenTarget?.unavailable ? null : safeProviderUrl(thread.providerOpenTarget?.url);
              const openThread = () => {
                if (providerUrl) {
                  window.open(providerUrl, "_blank", "noopener,noreferrer");
                  return;
                }
                navigate(`/timeline?threadId=${encodeURIComponent(thread.threadId)}&provider=${encodeURIComponent(thread.provider)}`);
              };
              return <button type="button" key={thread.threadId} onClick={openThread} aria-label={`Open ${thread.subject ?? "untitled thread"} from ${providerLabel(thread.provider)}`} className="flex w-full items-start gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-3 text-left hover:border-[#C84A1F]/40">
                <Hash size={14} strokeWidth={1.8} className="mt-0.5 text-[var(--text-muted)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px] text-[var(--text-default)]">{thread.subject ?? "Untitled thread"}</p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{providerLabel(thread.provider)} · {thread.accountLabel}</p>
                  {thread.latestMessage ? (
                    <p className="mt-0.5 line-clamp-1 font-sans text-[11px] text-[var(--text-muted)]">
                      {thread.latestMessage.senderLabel}: {thread.latestMessage.excerpt ?? ""}
                    </p>
                  ) : null}
                </div>
                <ExternalLink size={13} className="mt-0.5 flex-shrink-0 text-[var(--text-muted)]" />
              </button>;
            })}
          </div>
        </div>
      )}

      <div className="mt-8 w-full rounded-xl border border-[rgba(200,74,31,0.2)] bg-[#FBEEE8] px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-sans text-[13px] font-medium text-[var(--text-default)]">Manage connectors</p>
            <p className="mt-0.5 font-sans text-[12px] text-[var(--text-muted)]">Configure channels and sync settings in Integrations.</p>
          </div>
          <button type="button" onClick={() => navigate("/settings#integrations")} className="flex-shrink-0 rounded-full bg-[#C84A1F] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white hover:opacity-90">
            Open Integrations →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function MemoryPage() {
  const navigate = useNavigate();
  const { activeProject, projects, selectProject } = useAuth();
  const projectId = activeProject?.id;
  const searchRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsState, setDocsState] = useState<OperationalState<Doc[]>>({ state: "loading" });
  const [connectors, setConnectors] = useState<CommunicationConnector[]>([]);
  const [slackReadiness, setSlackReadiness] = useState<CommunicationConnectorReadiness | null>(null);
  const [threads, setThreads] = useState<CommunicationThreadSummary[]>([]);
  const [commsLoading, setCommsLoading] = useState(true);
  const [commsState, setCommsState] = useState<OperationalState<{ connectors: CommunicationConnector[]; threads: CommunicationThreadSummary[]; readiness: CommunicationConnectorReadiness[] }>>({ state: "loading" });
  const [connecting, setConnecting] = useState(false);
  const [activeTab, setActiveTab] = useState<MemoryTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const { toastState, showToast, dismissToast } = useToast();
  const [nextDocumentPage, setNextDocumentPage] = useState(2);
  const [hasMoreDocuments, setHasMoreDocuments] = useState(false);
  const [loadingMoreDocuments, setLoadingMoreDocuments] = useState(false);
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;
  const loadMoreDocuments = async () => {
    if (!projectId || loadingMoreDocuments) return;
    setLoadingMoreDocuments(true);
    try {
      const rows = await getDocs(projectId, nextDocumentPage);
      if (activeProjectRef.current !== projectId) return;
      setDocs((current) => [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))]);
      setNextDocumentPage((page) => page + 1);
      setHasMoreDocuments(rows.length === 25);
    } catch (error) { if (activeProjectRef.current === projectId) showToast(error instanceof Error ? error.message : "Could not load more documents", "terracotta"); }
    finally { if (activeProjectRef.current === projectId) setLoadingMoreDocuments(false); }
  };

  // Load documents
  useEffect(() => {
    if (!projectId) {
      setDocs([]);
      setDocsLoading(false);
      return;
    }
    let cancelled = false;
    setNextDocumentPage(2); setHasMoreDocuments(false); setLoadingMoreDocuments(false);
    setDocs([]);
    setDocsState({ state: "loading" });
    setDocsLoading(true);
    loadOperationalState(() => getDocs(projectId), (rows) => rows.length === 0)
      .then((state) => {
        if (cancelled) return;
        setDocsState(state);
        if (state.state === "ready" || state.state === "empty") {
          setDocs(state.data);
          setHasMoreDocuments(state.data.length === 25);
        }
      })
      .finally(() => { if (!cancelled) setDocsLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Load communications (connectors + recent threads)
  useEffect(() => {
    if (!projectId) {
      setConnectors([]);
      setSlackReadiness(null);
      setThreads([]);
      setCommsLoading(false);
      return;
    }
    let cancelled = false;
    setConnectors([]);
    setSlackReadiness(null);
    setThreads([]);
    setCommsState({ state: "loading" });
    setCommsLoading(true);
    loadOperationalState(
      async () => {
        const [connectorRows, threadRows, readiness] = await Promise.all([
          listCommunicationConnectors(projectId),
          getCommunicationThreads(projectId),
          getCommunicationReadiness(projectId),
        ]);
        return { connectors: connectorRows, threads: threadRows, readiness };
      },
      (result) => result.connectors.length === 0 && result.threads.length === 0
    )
      .then((state) => {
        if (cancelled) return;
        setCommsState(state);
        if (state.state === "ready" || state.state === "empty") {
          setConnectors(state.data.connectors.filter((connector, index, rows) => rows.findIndex((candidate) => candidate.id === connector.id) === index));
          setThreads(state.data.threads);
          setSlackReadiness(state.data.readiness.find((item) => item.provider === "slack") ?? null);
        }
      })
      .finally(() => { if (!cancelled) setCommsLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Cycle search placeholder
  useEffect(() => {
    if (searchFocused || searchQuery) return;
    const t = setInterval(() => setPlaceholderIndex((i) => (i + 1) % SEARCH_PLACEHOLDERS.length), 4000);
    return () => clearInterval(t);
  }, [searchFocused, searchQuery]);

  // CMD+K focus
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && searchQuery.trim()) {
      navigate(`/socrates?prefill=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleUploaded = (newDoc: Doc) => {
    setDocs((prev) => [newDoc, ...prev.filter((d) => d.id !== newDoc.id)]);
    setDocsState((previous) => {
      const priorRows = previous.state === "ready" || previous.state === "empty" ? previous.data : [];
      return {
        state: "ready",
        data: [newDoc, ...priorRows.filter((doc) => doc.id !== newDoc.id)],
        receivedAt: new Date().toISOString(),
      };
    });
  };

  const handleRemoveDoc = async (docId: string) => {
    if (!projectId) throw new Error("Select a workspace first.");
    await archiveDocument(projectId, docId);
    const authoritativeDocs = await getDocs(projectId);
    setNextDocumentPage(2); setHasMoreDocuments(authoritativeDocs.length === 25);
    setDocs(authoritativeDocs);
    const receivedAt = new Date().toISOString();
    setDocsState(authoritativeDocs.length === 0
      ? { state: "empty", data: [], receivedAt }
      : { state: "ready", data: authoritativeDocs, receivedAt });
    showToast("Document removed from project memory.", "terracotta");
  };

  const handleDownloadDoc = async (doc: Doc) => {
    if (!projectId) { showToast("Select a workspace first.", "terracotta"); return; }
    try {
      if(isDesktop()){const result=await saveDesktopDocument(projectId,doc.id);if(!result.cancelled)showToast('Original document saved.');return;}
      const blob = await getDocFileBlob(projectId, doc.id);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = doc.fileName ?? doc.name;
      anchor.click();
      URL.revokeObjectURL(href);
      showToast("Original document downloaded.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download the original document.", "terracotta");
    }
  };

  const handleConnectSlack = async () => {
    if (!projectId) { showToast("Select a workspace first.", "terracotta"); return; }
    if (!slackReadiness?.readiness.canConnect) {
      showToast("Slack is not configured by an administrator.", "terracotta");
      return;
    }
    setConnecting(true);
    try {
      const result = await connectSlack(projectId);
      if (result.redirectUrl) {
        const redirectUrl = safeExternalUrl(result.redirectUrl);
        if (!redirectUrl) throw new Error("Slack returned an unsafe redirect URL.");
        window.location.href = redirectUrl;
        return;
      }
      const refreshed = await listCommunicationConnectors(projectId);
      setConnectors(refreshed);
      showToast("Slack connected.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start Slack connection.", "terracotta");
    } finally {
      setConnecting(false);
    }
  };

  const filteredDocs = useMemo(() => docs.filter((d) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return [d.name, d.fileName ?? "", d.excerpt, d.uploadedBy].some((s) => s.toLowerCase().includes(q));
  }), [docs, searchQuery]);

  const showAll = activeTab === "all";
  const showDocs = activeTab === "source-docs" || showAll;
  const showComms = activeTab === "communications" || showAll;
  const docsInAll = showAll ? filteredDocs.slice(0, 3) : filteredDocs;
  const commsCount = connectors.length;

  return (
    <section className="relative h-full overflow-y-auto" style={{ background: "var(--bg-page)" }}>
      <div className="flex min-h-full">
        <div className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          <div className="max-w-[900px]">

            {/* Page header */}
            <div className="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Memory</p>
                <h1 className="mt-2 font-sans text-[36px] font-medium leading-none tracking-tight text-[var(--text-default)] sm:text-[46px] lg:text-[52px]">Project memory</h1>
                <div className="mt-3 flex flex-col gap-1.5">
                  <span className="h-[3px] w-20 rounded-full bg-[#C84A1F]" />
                  <span className="h-[3px] w-10 rounded-full bg-[var(--border-soft)]" />
                </div>
                <p className="mt-4 max-w-[600px] font-sans text-[14px] leading-relaxed text-[var(--text-muted)]">
                  Upload project docs, connect supported communication sources, and ask Socrates from one shared project memory.
                </p>
              </div>
              <p className="flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)] sm:mt-2">
                {docsLoading || commsLoading ? "Loading memory…" : `${docs.length} docs · ${commsCount} connectors`}
              </p>
            </div>

            {/* Workspace selector (multi-project) */}
            {projects.length > 1 && (
              <div className="relative mb-8 max-w-[460px]">
                <p className="font-mono text-[11px] tracking-[0.16em] text-[var(--text-muted)]">WORKSPACE</p>
                <button type="button" onClick={() => setWorkspaceMenuOpen((o) => !o)}
                  className="mt-2 flex w-full items-center justify-between gap-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-3.5 font-sans text-[14px] text-[var(--text-default)] shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-colors hover:border-[#C84A1F]/40">
                  <span className="truncate">{activeProject?.name ?? "Choose workspace"}</span>
                  <TbChevronDown className={`h-4 w-4 flex-shrink-0 text-[var(--terracotta-text)] transition-transform ${workspaceMenuOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {workspaceMenuOpen && (
                    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.14 }}
                      className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.12)]">
                      {projects.map((p) => (
                        <button key={p.id} type="button" onClick={() => { void selectProject(p.id); setWorkspaceMenuOpen(false); }}
                          className={`block w-full rounded-xl px-3 py-2.5 text-left font-sans text-[13px] transition-colors ${activeProject?.id === p.id ? "bg-[#1A1714] text-white" : "text-[#3D3834] hover:bg-[var(--bg-inset)]"}`}>
                          {p.name}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Upload card */}
            <div className="mb-8 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] sm:p-7">
              <div className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Upload</p>
                  <p className="mt-1.5 font-sans text-[18px] font-medium text-[var(--text-default)]">Add project documents</p>
                  <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-[var(--text-muted)]">
                    Socrates uses evidence from your selected, available project sources.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {["PDF", "DOCX"].map((f) => (
                    <span key={f} className="rounded-full bg-[rgba(200,74,31,0.06)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--terracotta-text)]">{f}</span>
                  ))}
                </div>
              </div>
              <DropZone onUploaded={handleUploaded} showToast={showToast} />
            </div>

            {/* Search bar */}
            <div className="mb-7 flex h-14 items-center gap-3 rounded-xl border px-5 transition-all duration-150"
              style={{ background: "var(--bg-card)", borderColor: searchFocused ? "#C84A1F" : "var(--border-soft)", boxShadow: searchFocused ? "0 0 0 2px rgba(200,74,31,0.15)" : "0 2px 8px rgba(0,0,0,0.04)" }}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: searchFocused ? "var(--terracotta-text)" : "var(--text-muted)", flexShrink: 0, transition: "color 150ms" }}>
                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12.5 12.5L15.5 15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onKeyDown={handleSearchKey}
                placeholder={SEARCH_PLACEHOLDERS[placeholderIndex]}
                className="min-w-0 flex-1 bg-transparent font-sans text-[14px] text-[var(--text-default)] outline-none placeholder:text-[var(--text-faint)] placeholder:transition-all"
              />
              <kbd className="flex-shrink-0 rounded-md border border-[var(--border-soft)] bg-[var(--bg-inset)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)]">⌘K</kbd>
            </div>

            {/* Tabs */}
            <div role="tablist" aria-label="Memory sources" className="mb-7 grid grid-cols-3 border-b border-[var(--border-soft)]">
              {(["all", "source-docs", "communications"] as MemoryTab[]).map((tab) => {
                const labels = { all: "All", "source-docs": "Source Docs", communications: "Communications" };
                const counts = { all: docs.length + commsCount, "source-docs": docs.length, communications: commsCount };
                const active = tab === activeTab;
                return (
                  <div key={tab} className="relative min-w-0">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(tab)}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                        event.preventDefault();
                        const tabs: MemoryTab[] = ["all", "source-docs", "communications"];
                        const direction = event.key === "ArrowRight" ? 1 : -1;
                        const next = tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length];
                        setActiveTab(next);
                        const buttons = event.currentTarget.closest("[role='tablist']")?.querySelectorAll<HTMLElement>("[role='tab']");
                        buttons?.[tabs.indexOf(next)]?.focus();
                      }}
                      className={`w-full px-1 py-3 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors sm:px-5 sm:text-[11px] sm:tracking-[0.14em] ${active ? "text-[var(--text-default)]" : "text-[var(--text-muted)] hover:text-[var(--text-default)]"}`}
                    >
                      {labels[tab]}
                      <span className={`ml-1.5 ${active ? "text-[var(--text-muted)]" : "text-[var(--text-faint)]"}`}>({counts[tab]})</span>
                    </button>
                    {active && (
                      <motion.div layoutId="tab-underline" className="absolute bottom-[-1px] left-0 right-0 h-[2px] rounded-full bg-[#C84A1F]" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Content area */}
            <AnimatePresence>
              {/* Source docs section */}
              {(showDocs) && (
                <motion.div key="docs-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-8">
                  {showAll && <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Source Documents</p>}
                  <div className="flex flex-col gap-3">
                    {!docsLoading && !["ready", "empty"].includes(docsState.state) ? (
                      <OperationalStateNotice value={docsState} />
                    ) : null}
                    {docsLoading ? (
                      <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] px-6 py-10">
                        <RefreshCw size={22} strokeWidth={1.6} className="animate-spin text-[var(--terracotta-text)]" />
                        <p className="font-sans text-[13px] text-[var(--text-muted)]">Loading documents…</p>
                      </div>
                    ) : (
                      <AnimatePresence>
                        {docsInAll.map((doc) => (
                          <DocCard key={doc.id} doc={doc} onRemove={handleRemoveDoc} onDownload={handleDownloadDoc} />
                        ))}
                      </AnimatePresence>
                    )}
                    {!docsLoading && docsState.state === "empty" && (
                      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] px-6 py-8 text-center">
                        <p className="font-sans text-[14px] text-[var(--text-muted)]">No documents uploaded yet. Drag a PDF or DOCX above to get started.</p>
                      </div>
                    )}
                  </div>
                  {showAll && filteredDocs.length > 3 && (
                    <button type="button" onClick={() => setActiveTab("source-docs")} className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--terracotta-text)] hover:underline">
                      Show all {filteredDocs.length} docs →
                    </button>
                  )}
                  {!showAll && hasMoreDocuments && <button type="button" disabled={loadingMoreDocuments} onClick={() => void loadMoreDocuments()} className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--terracotta-text)] hover:underline">{loadingMoreDocuments ? "Loading…" : "Load more documents"}</button>}
                </motion.div>
              )}

              {/* Communications section */}
              {showComms && (
                <motion.div key="comms-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {showAll && <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Communications</p>}
                  <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-4 sm:p-7">
                    {!commsLoading && !["ready", "empty"].includes(commsState.state) ? (
                      <OperationalStateNotice value={commsState} />
                    ) : (
                      <CommunicationsPanel
                        loading={commsLoading}
                        connectors={connectors}
                        threads={threads}
                        onConnect={() => { void handleConnectSlack(); }}
                        connecting={connecting}
                        slackReadiness={slackReadiness}
                      />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
      <Toast message={toastState.message} visible={toastState.visible} type={toastState.type} onClose={dismissToast} />
    </section>
  );
}
