export function vectorDistanceToSimilarity(distance: number | null | undefined, fallback = 0.5) {
  if (typeof distance !== "number" || Number.isNaN(distance)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, 1 - distance));
}
export function weightedHybridScore(input: {
  vectorScore?: number;
  lexicalScore?: number;
  graphScore?: number;
  vectorWeight?: number;
  lexicalWeight?: number;
  graphWeight?: number;
}) {
  const vectorWeight = input.vectorWeight ?? 0.55;
  const lexicalWeight = input.lexicalWeight ?? 0.3;
  const graphWeight = input.graphWeight ?? 0.15;
  return (
    (input.vectorScore ?? 0) * vectorWeight +
    (input.lexicalScore ?? 0) * lexicalWeight +
    (input.graphScore ?? 0) * graphWeight
  );
}
