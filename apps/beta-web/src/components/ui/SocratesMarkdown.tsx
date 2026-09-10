import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { safeMarkdownUrl } from "../../lib/socratesPresentation";

export function SocratesMarkdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <div className="socrates-markdown font-sans text-[14px] leading-relaxed text-[var(--text-default)]" aria-live={streaming ? "polite" : undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
