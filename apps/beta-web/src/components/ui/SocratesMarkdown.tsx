import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { resolveOpenTarget, safeMarkdownUrl, targetForCitation } from "../../lib/socratesPresentation";
import type { Citation, OpenTarget } from "../../store/chatStore";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

const EMPTY_CITATIONS: Citation[] = [];
const EMPTY_TARGETS: OpenTarget[] = [];
const NON_PROSE_NODES = new Set(["link", "linkReference", "image", "imageReference", "code", "inlineCode", "html", "definition"]);

function evidenceLinks(citations: Citation[], openTargets: OpenTarget[]) {
  const links = new Map<number, string>();
  for (const citation of citations) {
    const number = citation.evidenceNumber;
    // An ordinal is prompt identity, not the citation's position in this array.
    // Missing, duplicate or broken identity must never silently select a source.
    if (number === undefined || !Number.isInteger(number) || number < 1 || number > 10
      || citations.filter((item) => item.evidenceNumber === number).length !== 1
      || !citation.openTargetId
      || openTargets.filter((target) => target.id === citation.openTargetId).length !== 1) continue;
    const resolved = resolveOpenTarget(targetForCitation(citation, openTargets));
    const href = resolved && safeMarkdownUrl(resolved.href);
    if (href) links.set(number, href);
  }

  return function remarkEvidenceLinks() {
    return (tree: MarkdownNode) => {
      const visit = (node: MarkdownNode) => {
        if (!node.children || NON_PROSE_NODES.has(node.type)) return;
        node.children = node.children.flatMap((child) => {
          if (child.type !== "text" || typeof child.value !== "string") {
            visit(child);
            return [child];
          }
          return child.value.split(/(\[E\d+\])/gi).filter(Boolean).map((value): MarkdownNode => {
            const match = /^\[E(\d+)\]$/i.exec(value);
            const href = match && links.get(Number(match[1]));
            return href ? { type: "link", url: href, children: [{ type: "text", value }] } : { type: "text", value };
          });
        });
      };
      if (links.size) visit(tree);
    };
  };
}

export function SocratesMarkdown({ content, streaming = false, citations = EMPTY_CITATIONS, openTargets = EMPTY_TARGETS }: {
  content: string;
  streaming?: boolean;
  citations?: Citation[];
  openTargets?: OpenTarget[];
}) {
  const citationPlugin = useMemo(() => evidenceLinks(citations, openTargets), [citations, openTargets]);
  return (
    <div className="socrates-markdown font-sans text-[14px] leading-relaxed text-[var(--text-default)]" aria-live={streaming ? "polite" : undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, citationPlugin]}
        skipHtml
        urlTransform={(url) => safeMarkdownUrl(url) ?? ""}
        components={{
          h1: ({ children }) => <h2 className="mb-2 mt-4 text-[17px] font-semibold first:mt-0">{children}</h2>,
          h2: ({ children }) => <h3 className="mb-2 mt-4 text-[15px] font-semibold first:mt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-[14px] font-semibold first:mt-0">{children}</h4>,
          p: ({ children }) => <p className="mb-2 whitespace-pre-wrap last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-[var(--teal)] pl-3 text-[var(--text-muted)]">{children}</blockquote>,
          a: ({ href, children }) => {
            const safeHref = href ? safeMarkdownUrl(href) : null;
            if (!safeHref) return <span>{children}</span>;
            const external = /^https?:\/\//i.test(safeHref);
            const className = "font-medium text-[var(--teal-text)] underline decoration-1 underline-offset-2";
            return external
              ? <a href={safeHref} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
              : <Link to={safeHref} className={className}>{children}</Link>;
          },
          pre: ({ children }) => <pre className="my-2 max-w-full overflow-x-auto rounded-lg bg-[var(--bg-inset)] p-3 text-[12px]">{children}</pre>,
          code: ({ children }) => <code className="rounded bg-[var(--bg-inset)] px-1 py-0.5 font-mono text-[12px]">{children}</code>,
          table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="min-w-full border-collapse text-left text-[12px]">{children}</table></div>,
          th: ({ children }) => <th className="border border-[var(--border-soft)] bg-[var(--bg-inset)] px-2 py-1.5 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-[var(--border-soft)] px-2 py-1.5 align-top">{children}</td>,
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
