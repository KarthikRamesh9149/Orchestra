import { RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import type { OperationalFailureState, OperationalState } from "../../lib/api/operationalState";

const LABELS: Record<OperationalFailureState, string> = {
  disconnected: "Disconnected",
  forbidden: "Access unavailable",
  degraded: "Service degraded",
  stale: "Data is stale",
  failed: "Could not load"
};

export function OperationalStateNotice<T>({
  value,
  onRetry,
  emptyMessage = "Nothing here yet."
}: {
  value: OperationalState<T>;
  onRetry?: () => void;
  emptyMessage?: string;
}) {
  if (value.state === "loading" || value.state === "ready") return null;
  if (value.state === "empty") {
    return (
      <div role="status" className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-4 py-3">
        <p className="font-sans text-[12px] text-[var(--text-muted)]">{emptyMessage}</p>
      </div>
    );
  }

  const Icon = value.state === "disconnected" ? WifiOff : TriangleAlert;
  return (
    <div role="alert" className="rounded-lg border border-[#C84A1F]/20 bg-[#C84A1F]/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <Icon size={15} className="mt-0.5 flex-shrink-0 text-[#C84A1F]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#C84A1F]">{LABELS[value.state]}</p>
          <p className="mt-1 font-sans text-[12px] text-[var(--text-default)]">{value.error.message}</p>
          <p className="mt-1 font-mono text-[9px] text-[var(--text-faint)]">Error code: {value.error.code}</p>
        </div>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#C84A1F]">
            <RefreshCw size={10} aria-hidden="true" /> Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
