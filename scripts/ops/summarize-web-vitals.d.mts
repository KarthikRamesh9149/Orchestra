export interface WebVitalSummary {
  metric: string;
  device: string;
  samples: number;
  sampleP75: number;
  threshold: number;
  withinThreshold: boolean;
  qualification: string;
}
export function summarizeWebVitals(lines: string): WebVitalSummary[];
