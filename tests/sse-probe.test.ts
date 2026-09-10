import { expect, it } from "vitest";
import { readSseProbe } from "../scripts/ops/lib/sse-probe.js";

it("reassembles split SSE frames and requires authoritative completion", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) {
    for (const text of ['event: del', 'ta\r\ndata: {"text":"Hello"}\r\n\r\n', 'event: done\ndata: {"answer_md":"Hello"}\n\n']) controller.enqueue(encoder.encode(text));
    controller.close();
  } });
  const result = await readSseProbe(new Response(stream), 0, () => 20);
  expect(result.value).toEqual({ data: { answer_md: "Hello" } });
  expect(result.firstDeltaMs).toBe(20);
  await expect(readSseProbe(new Response('event: delta\ndata: {"text":"partial"}\n\n'), 0)).rejects.toThrow("without completion");
});

it("does not expose server error details", async () => {
  await expect(readSseProbe(new Response('event: error\ndata: {"message":"sensitive"}\n\n'), 0)).rejects.toThrow("Streaming request failed");
});
