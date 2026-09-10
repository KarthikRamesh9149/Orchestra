type Labels = Record<string, string | number | boolean | null | undefined>;

type HistogramState = {
  count: number;
  sum: number;
  buckets: number[];
};

function formatLabels(labels: Labels) {
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    return "";
  }

  const rendered = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`)
    .join(",");

  return `{${rendered}}`;
}

function toMetricKey(name: string, labels: Labels) {
  return `${name}${formatLabels(labels)}`;
}

export class TelemetryService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly histogramBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  increment(name: string, labels: Labels = {}, amount = 1) {
    const key = toMetricKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  setGauge(name: string, value: number, labels: Labels = {}) {
    const key = toMetricKey(name, labels);
    this.gauges.set(key, value);
  }

  observeDuration(name: string, durationMs: number, labels: Labels = {}) {
    const key = toMetricKey(name, labels);
    const histogram =
      this.histograms.get(key) ??
      {
        count: 0,
        sum: 0,
        buckets: Array.from({ length: this.histogramBuckets.length }, () => 0)
      };

    histogram.count += 1;
    histogram.sum += durationMs;
    for (const [index, bucket] of this.histogramBuckets.entries()) {
      if (durationMs <= bucket) {
        histogram.buckets[index] += 1;
      }
    }

    this.histograms.set(key, histogram);
  }

  renderPrometheus() {
    const lines: string[] = [];

    for (const [key, value] of this.counters.entries()) {
      lines.push(`${key} ${value}`);
    }

    for (const [key, value] of this.gauges.entries()) {
      lines.push(`${key} ${value}`);
    }

    for (const [key, value] of this.histograms.entries()) {
      const name = key.split("{")[0];
      const labels = key.includes("{") ? key.slice(key.indexOf("{")) : "";
      for (const [index, bucket] of this.histogramBuckets.entries()) {
        const prefix = labels ? labels.slice(0, -1) + `,le="${bucket}"}` : `{le="${bucket}"}`;
        lines.push(`${name}_bucket${prefix} ${value.buckets[index]}`);
      }
      const infLabels = labels ? labels.slice(0, -1) + ',le="+Inf"}' : '{le="+Inf"}';
      lines.push(`${name}_bucket${infLabels} ${value.count}`);
      lines.push(`${name}_sum${labels} ${value.sum}`);
      lines.push(`${name}_count${labels} ${value.count}`);
    }

    return lines.join("\n");
  }
}
