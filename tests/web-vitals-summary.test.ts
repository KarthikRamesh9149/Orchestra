import { expect, it } from "vitest";
import { summarizeWebVitals } from "../scripts/ops/summarize-web-vitals.mjs";

it("keeps the latest observation per metric ID before calculating per-device p75", () => {
  const entries = [
    { sampleId: "a", value: 1000, time: 1 },
    { sampleId: "b", value: 2000, time: 1 },
    { sampleId: "c", value: 3000, time: 1 },
    { sampleId: "d", value: 4000, time: 1 },
    { sampleId: "a", value: 5000, time: 2 },
    { sampleId: "a", value: 500, time: 1 }
  ].map(x => JSON.stringify({ message: "browser_web_vital", metric: "LCP", device: "mobile", privateText: "not emitted", ...x }));
  const summary = summarizeWebVitals(entries.join("\n"));
  expect(summary).toEqual([expect.objectContaining({ metric: "LCP", device: "mobile", samples: 4, sampleP75: 4000, threshold: 2500, withinThreshold: false })]);
  expect(JSON.stringify(summary)).not.toContain("privateText");
});
