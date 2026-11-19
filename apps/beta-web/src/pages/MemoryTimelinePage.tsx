import { motion } from "framer-motion";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MemoryPage } from "./MemoryPage";
import { TimelinePage } from "./TimelinePage";

type Panel = "memory" | "timeline";

export function MemoryTimelinePage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const active: Panel = location.pathname.startsWith("/timeline") || searchParams.get("panel") === "timeline" ? "timeline" : "memory";

  const selectPanel = (panel: Panel) => {
    const next = new URLSearchParams(searchParams);
    next.delete("panel");
    if (panel === "timeline") navigate({ pathname: "/timeline", search: next.toString() ? `?${next}` : "" });
    else navigate({ pathname: "/memory", search: next.toString() ? `?${next}` : "" });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--bg-page)" }}>
      {/* Toggle bar */}
      <div
        className="sr-only focus-within:not-sr-only focus-within:flex focus-within:px-4 focus-within:py-2"
        style={{ borderBottom: "1px solid var(--border-soft)" }}
      >
        <div
          role="tablist"
          aria-label="Project memory sections"
          className="relative flex items-center gap-0.5 rounded-full p-1"
          style={{ background: "var(--bg-inset)", border: "1px solid var(--border-soft)" }}
        >
          {(["memory", "timeline"] as Panel[]).map((panel) => {
            const isActive = active === panel;
            return (
              <button
                key={panel}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => selectPanel(panel)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const next = panel === "memory" ? "timeline" : "memory";
                  selectPanel(next);
                  event.currentTarget.parentElement?.querySelector<HTMLElement>(`[role="tab"]:nth-of-type(${next === "memory" ? 1 : 2})`)?.focus();
                }}
                className="relative z-10 rounded-full px-5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-150"
                style={{
                  color: isActive ? "#FFFFFF" : "var(--text-muted)",
                }}
              >
                {isActive && (
                  <motion.span
                    layoutId="memory-toggle-pill"
                    className="absolute inset-0 rounded-full"
                    style={{ background: "var(--terracotta)" }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{panel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Panels */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {active === "memory" ? <MemoryPage /> : <TimelinePage />}
      </div>
    </div>
  );
}
