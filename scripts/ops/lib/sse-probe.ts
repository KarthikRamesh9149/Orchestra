export async function readSseProbe(response: Response, startedAt: number, now = Date.now) {
  const ttfbMs = now() - startedAt;
  if (!response.ok || !response.body) throw new Error("Streaming request failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstDeltaMs: number | null = null;
  let completed: Record<string, unknown> | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Normalize only after concatenating, so split CRLF boundaries survive.
      buffer = buffer.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = frame.split("\n");
        const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
        if (event === "error") throw new Error("Streaming request failed");
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if (event === "delta" && typeof parsed.text === "string" && parsed.text.length > 0) firstDeltaMs ??= now() - startedAt;
        if (event === "done") completed = parsed;
      }
      if (done) break;
    }
    if (!completed) throw new Error("Stream ended without completion");
    return { status: response.status, value: { data: completed }, ttfbMs, firstDeltaMs, completionMs: now() - startedAt };
  } finally { reader.releaseLock(); }
}
