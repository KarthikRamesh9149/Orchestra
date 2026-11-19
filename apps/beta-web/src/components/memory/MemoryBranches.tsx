import {
  ArrowUpRight,
  BookOpen,
  FileText,
  GitBranch,
  MessageSquare,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getDocViewer } from "../../lib/api/documents";
import {
  getTruthChangePacket,
  getTruthInbox,
  type TruthInboxItem,
} from "../../lib/api/truthInbox";
import {
  resolveOpenTarget,
  safeExternalUrl,
} from "../../lib/socratesPresentation";
import type { CommunicationThreadSummary } from "../../lib/api/memory";
import type { Doc } from "../../lib/types";

type Topic = {
  id: string;
  label: string;
  kind: "proposal" | "document" | "conversation";
  detail: string;
  state?: string;
};
type RecordRow = {
  id: string;
  label: string;
  meta: string;
  excerpt: string;
  href?: string;
  external?: boolean;
};
type Selection = {
  id: string;
  records: RecordRow[];
  wording?: { label: "Recorded decision" | "Accepted change"; text: string };
  error?: string;
  more?: boolean;
};
type Props = {
  projectId: string;
  projectName: string;
  documents: Doc[];
  threads: CommunicationThreadSummary[];
  loading: boolean;
  onSources: () => void;
};

function topicFromProposal(item: TruthInboxItem): Topic {
  return {
    id: item.id,
    label: item.title,
    kind: "proposal",
    detail: item.description,
    state: item.comparison?.status ?? item.status,
  };
}

// A node is a persisted proposal, source document or conversation, never a topic inferred from a title.
// Only the selected node loads its evidence; this never fetches a packet or viewer for every row.
export function MemoryBranches({
  projectId,
  projectName,
  documents,
  threads,
  loading,
  onSources,
}: Props) {
  const board = useRef<HTMLDivElement>(null);
  const wire = useRef<SVGSVGElement>(null);
  const [queue, setQueue] = useState<{
    items: Topic[];
    error?: string;
    partial?: boolean;
  } | null>(null);
  const [selected, setSelected] = useState("");
  const [picked, setPicked] = useState("");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = (status: string) =>
      getTruthInbox(
        projectId,
        { source: "proposal", status, limit: 12 },
        controller.signal,
      );
    void Promise.allSettled([load("active"), load("resolved")]).then(
      (results) => {
        if (controller.signal.aborted) return;
        const rows = results.flatMap((result) =>
          result.status === "fulfilled" ? result.value.items : [],
        );
        setQueue({
          items: [
            ...new Map(
              rows.map((item) => [item.id, topicFromProposal(item)]),
            ).values(),
          ],
          partial: results.some(
            (r) => r.status === "fulfilled" && r.value.page.hasMore,
          ),
          error: results.some((r) => r.status === "rejected")
            ? "Some review topics could not be loaded."
            : undefined,
        });
      },
    );
    return () => controller.abort();
  }, [projectId, attempt]);
  const topics = useMemo<Topic[]>(
    () => [
      ...(queue?.items ?? []),
      ...documents.map((doc) => ({
        id: doc.id,
        label: doc.name,
        kind: "document" as const,
        detail: doc.excerpt,
        state: doc.status,
      })),
      ...threads.map((t) => ({
        id: t.threadId,
        label: t.subject || t.accountLabel,
        kind: "conversation" as const,
        detail: [
          t.provider,
          t.latestMessage?.senderLabel,
          t.latestMessage?.excerpt,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    ],
    [queue, documents, threads],
  );
  const filtered = useMemo(
    () =>
      topics.filter((t) =>
        (t.label + " " + t.kind + " " + t.detail)
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      ),
    [topics, query],
  );
  const topic = filtered.find((t) => t.id === selected) ?? filtered[0];
  const thread =
    topic?.kind === "conversation"
      ? threads.find((t) => t.threadId === topic.id)
      : undefined;
  const topicId = topic?.id,
    kind = topic?.kind,
    state = topic?.state;
  useEffect(() => {
    if (!topicId || !kind) return;
    const controller = new AbortController();
    async function read(): Promise<Selection> {
      if (kind === "proposal") {
        const packet = await getTruthChangePacket(
          projectId,
          topicId!,
          controller.signal,
        );
        const records: RecordRow[] = packet.newEvidence.map((e) => {
          const target =
            e.openTarget &&
            resolveOpenTarget({
              id: e.id,
              sourceType: e.source,
              ...e.openTarget,
            });
          return {
            id: e.id,
            label: e.label,
            meta: e.source.replace(/_/g, " "),
            excerpt: e.excerpt ?? "",
            href: target?.href,
            external: target?.external,
          };
        });
        for (const ref of packet.affected.productAreas.filter(
          (r) => r.type === "document_section",
        )) {
          const target =
            ref.openTarget &&
            resolveOpenTarget({
              id: ref.id,
              sourceType: ref.type,
              ...ref.openTarget,
            });
          if (!records.some((row) => row.href && row.href === target?.href))
            records.push({
              id: ref.id,
              label: ref.label,
              meta:
                ref.status === "historical_document_version"
                  ? "Earlier revision"
                  : "Document section",
              excerpt: ref.detail,
              href: target?.href,
            });
        }
        const decision = packet.currentAcceptedTruth.find((r) => r.type === "accepted_decision");
        const acceptedWording = packet.item?.comparison?.acceptedWording;
        return {
          id: topicId!,
          records,
          wording: decision ? { label: "Recorded decision", text: decision.detail }
            : acceptedWording ? { label: "Accepted change", text: acceptedWording } : undefined,
        };
      }
      if (kind === "conversation" && thread) {
        const msg = thread.latestMessage;
        const remote =
          !thread.providerOpenTarget?.unavailable &&
          safeExternalUrl(thread.providerOpenTarget?.url);
        return {
          id: topicId!,
          records: msg
            ? [
                {
                  id: msg.id,
                  label: msg.senderLabel,
                  meta: thread.provider,
                  excerpt: msg.excerpt || "",
                  href: remote || undefined,
                  external: !!remote,
                },
              ]
            : [],
        };
      }
      if (kind !== "document" || !["ready", "partial"].includes(state ?? ""))
        return { id: topicId!, records: [] };
      const doc = await getDocViewer(
        projectId,
        topicId!,
        undefined,
        controller.signal,
      );
      const versionId =
        doc.version && typeof doc.version === "object"
          ? doc.version.id
          : doc.document?.currentVersionId;
      return {
        id: topicId!,
        more: doc.meta?.hasMore,
        records: doc.sections.map((section, i) => ({
          id: section.sectionId || section.id || section.anchorId,
          label:
            section.headingPath?.join(" / ") ||
            section.citationLabel ||
            (section.pageNumber
              ? "Page " + section.pageNumber
              : "Passage " + (i + 1)),
          meta: "Document passage",
          excerpt: section.text || section.content || "",
          href: `/memory/docs/${encodeURIComponent(topicId!)}/view${versionId ? "?versionId=" + encodeURIComponent(versionId) : ""}#${encodeURIComponent(section.anchorId)}`,
        })),
      };
    }
    void read().then(
      (result) => {
        if (!controller.signal.aborted) setSelection(result);
      },
      (err) => {
        if (!controller.signal.aborted)
          setSelection({
            id: topicId,
            records: [],
            error:
              err instanceof Error
                ? err.message
                : "Could not open these records.",
          });
      },
    );
    return () => controller.abort();
  }, [projectId, topicId, kind, state, thread, attempt]);
  const data = selection?.id === topicId ? selection : null;
  const record = data?.records.find((r) => r.id === picked) ?? data?.records[0];
  // Endpoints follow visible rows, including keyboard/scroll selection; on narrow
  // windows the same ordered controls form an indented tree without SVG.
  useEffect(() => {
    const base = board.current,
      svg = wire.current;
    if (!base || !svg || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      if (!svg.getClientRects().length) return;
      const rect = svg.getBoundingClientRect();
      const roots = base
        .querySelector(".branch-root h2")
        ?.getBoundingClientRect();
      if (!roots) return;
      const paths: SVGPathElement[] = [];
      const visible = (el: Element) => {
        const box = el.getBoundingClientRect(),
          list = el.parentElement!.getBoundingClientRect();
        const y = box.top + box.height / 2;
        return y >= list.top && y <= list.bottom;
      };
      const connect = (
        left: DOMRect,
        right: DOMRect,
        active: boolean,
        evidence: boolean,
      ) => {
        const x1 = left.right - rect.left,
          x2 = right.left - rect.left,
          y1 = left.top + left.height / 2 - rect.top,
          y2 = right.top + right.height / 2 - rect.top;
        const mid = (x1 + x2) / 2,
          path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute(
          "d",
          `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
        );
        path.dataset.active = String(active);
        path.dataset.evidence = String(evidence);
        paths.push(path);
      };
      for (const node of base.querySelectorAll(".branch-topics > button")) {
        if (!visible(node)) continue;
        const active = node.getAttribute("aria-pressed") === "true",
          bounds = node.getBoundingClientRect();
        connect(roots, bounds, active, false);
        if (active)
          for (const row of base.querySelectorAll(".branch-records > button"))
            if (visible(row))
              connect(bounds, row.getBoundingClientRect(), false, true);
      }
      svg.replaceChildren(...paths);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(schedule);
    for (const el of [
      base,
      ...base.querySelectorAll(".branch-nodes,.branch-root"),
    ])
      observer.observe(el);
    base.addEventListener("scroll", schedule, true);
    schedule();
    return () => {
      observer.disconnect();
      base.removeEventListener("scroll", schedule, true);
      cancelAnimationFrame(frame);
    };
  }, [filtered, topicId, data]);
  return (
    <div className="memory-branches">
      <div className="branch-search">
        <Search size={16} />
        <input
          aria-label="Find a topic, source or person"
          placeholder="Find a topic, source or person"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <small>
          {filtered.length} {filtered.length === 1 ? "branch" : "branches"}{" "}
          shown
        </small>
      </div>
      {queue?.error && (
        <p className="desk-alert" role="status">
          {queue.error}{" "}
          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      )}
      {!filtered.length ? (
        <p className="desk-empty" role="status">
          {loading || !queue
            ? "Loading project memory…"
            : query
              ? "No matching branches in this view."
              : "No sources yet. Add a project document to trace its passages here."}
        </p>
      ) : (
        <div className="branch-board" ref={board}>
          <svg
            ref={wire}
            className="branch-wire"
            aria-hidden="true"
            focusable="false"
          />
          <div className="branch-root">
            <small>Project</small>
            <GitBranch size={31} strokeWidth={1.35} />
            <h2>{projectName}</h2>
          </div>
          <div className="branch-col">
            <small>Topics &amp; sources</small>
            <div
              className="branch-nodes branch-topics"
              aria-label="Memory branches"
            >
              {filtered.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  aria-pressed={topicId === t.id}
                  onClick={() => {
                    setSelected(t.id);
                    setPicked("");
                  }}
                >
                  <span>{t.label}</span>
                  <small>
                    {t.kind === "proposal"
                      ? "Change packet"
                      : t.kind === "document"
                        ? "Document"
                        : "Conversation"}
                    {t.state && " · " + t.state.replace(/_/g, " ")}
                  </small>
                </button>
              ))}
            </div>
          </div>
          <div className="branch-col">
            <small>Linked evidence</small>
            <div
              className="branch-nodes branch-records"
              aria-label="Linked records"
            >
              {!data ? (
                <p role="status">Loading records…</p>
              ) : data.error ? (
                <p role="alert">
                  {data.error}{" "}
                  <button
                    className="desk-link"
                    onClick={() => setAttempt((v) => v + 1)}
                  >
                    Retry
                  </button>
                </p>
              ) : !data.records.length ? (
                <p>
                  {state === "processing"
                    ? "Processing this document…"
                    : state === "failed"
                      ? "Document processing failed. Open the source list to retry."
                      : "No linked passages are available."}
                </p>
              ) : (
                data.records.map((r) => (
                  <button
                    key={r.id}
                    aria-pressed={record?.id === r.id}
                    onClick={() => setPicked(r.id)}
                  >
                    {kind === "conversation" ? (
                      <MessageSquare size={15} />
                    ) : (
                      <FileText size={15} />
                    )}
                    <span>
                      <small>{r.meta}</small>
                      {r.label}
                    </span>
                  </button>
                ))
              )}
            </div>
            {data?.more && <small>More passages in the document viewer</small>}
          </div>
        </div>
      )}
      {topic && (
        <div className="branch-reading">
          {data?.wording && (
            <p className="branch-wording">
              <small>{data.wording.label}</small>
              {data.wording.text}
            </p>
          )}
          {record && (
            <div>
              <span className="desk-meta">
                <BookOpen size={14} />
                {record.meta}
              </span>
              <h2>{record.label}</h2>
              {record.excerpt && <blockquote>{record.excerpt}</blockquote>}
              {record.href ? (
                record.external ? (
                  <a
                    className="desk-link"
                    href={record.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open original <ArrowUpRight size={14} />
                  </a>
                ) : (
                  <Link className="desk-link" to={record.href}>
                    Open passage <ArrowUpRight size={14} />
                  </Link>
                )
              ) : (
                <small>No direct source link available</small>
              )}
            </div>
          )}
          {kind === "proposal" && (
            <Link
              className="desk-link"
              to={`/truth-inbox/${encodeURIComponent(topic.id)}`}
            >
              Open change packet →
            </Link>
          )}
        </div>
      )}
      <footer className="branch-foot">
        {queue?.partial ? "Recent review topics are shown. " : ""}Find more
        documents and conversations in the{" "}
        <button type="button" className="desk-link" onClick={onSources}>
          source list
        </button>
        .
      </footer>
    </div>
  );
}
