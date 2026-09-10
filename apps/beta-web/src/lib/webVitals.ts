import { onCLS, onINP, onLCP, type Metric } from "web-vitals";
import { ensureCsrfToken, rawJson } from "./api/client";

let started = false;

export async function reportWebVital(metric: Pick<Metric, "id" | "name" | "value">, viewportWidth: number) {
  if (!["LCP", "INP", "CLS"].includes(metric.name) || !Number.isFinite(metric.value) || metric.value < 0) return;
  try {
    const csrf = await ensureCsrfToken();
    // rawJson deliberately avoids cache invalidation and refresh/retry loops:
    // measurement must not evict page data or compete with user work on failure.
    await rawJson("/v1/me/web-vitals", {
      method: "POST", keepalive: true,
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({ metric: metric.name, value: metric.value, sampleId: metric.id,
        device: viewportWidth < 768 ? "mobile" : viewportWidth < 1024 ? "tablet" : "desktop" })
    });
  } catch { /* Best-effort metrics must never interrupt the product. */ }
}

export function startWebVitals() {
  if (started) return;
  started = true;
  const width = window.innerWidth;
  const report = (metric: Metric) => { void reportWebVital(metric, width); };
  onCLS(report); onINP(report); onLCP(report);
}
