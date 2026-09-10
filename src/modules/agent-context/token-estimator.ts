export function estimateAgentContextTokens(text: string) {
  return {
    estimate: estimateApproximateTokens(text),
    method: "chars_div_4" as const
  };
}

export function estimateApproximateTokens(text: string) {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
