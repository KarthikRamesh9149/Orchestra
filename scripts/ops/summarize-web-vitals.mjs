// Pipe existing first-party Railway JSON logs here. No customer data is emitted.
export function summarizeWebVitals(lines) {
  const latest = new Map();
  const thresholds = { LCP: 2500, INP: 200, CLS: 0.1 };
  for (const line of lines.split("\n")) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || entry.message !== "browser_web_vital" || !Object.hasOwn(thresholds, entry.metric)
      || !["mobile", "tablet", "desktop"].includes(entry.device)
      || typeof entry.sampleId !== "string" || !Number.isFinite(entry.value) || entry.value < 0) continue;
    const key = `${entry.metric}:${entry.sampleId}`;
    const time = Number(entry.time) || Date.parse(entry.timestamp) || 0;
    if (!latest.has(key) || time >= latest.get(key).time) latest.set(key, { metric: entry.metric, device: entry.device, value: entry.value, time });
  }
  return Object.entries(thresholds).flatMap(([metric, threshold]) => ["mobile", "tablet", "desktop"].flatMap(device => {
    const values = [...latest.values()].filter(x => x.metric === metric && x.device === device).map(x => x.value).sort((a, b) => a - b);
    if (!values.length) return [];
    const p75 = values[Math.ceil(values.length * 0.75) - 1];
    return [{ metric, device, samples: values.length, sampleP75: p75, threshold,
      withinThreshold: p75 <= threshold, qualification: "Recorded samples only; assess cohort representativeness before making product-wide claims." }];
  }));
}

if (process.argv[1]?.endsWith("summarize-web-vitals.mjs")) {
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  console.log(JSON.stringify(summarizeWebVitals(input), null, 2));
}
