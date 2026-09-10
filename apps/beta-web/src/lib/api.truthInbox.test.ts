import { beforeEach, describe, expect, it, vi } from "vitest";
import { actOnTruthInboxItem, getTruthChangePacket, getTruthInbox } from "./api/truthInbox";

const apiJson = vi.fn();
vi.mock("./api/client", () => ({ apiJson: (...args: unknown[]) => apiJson(...args) }));

describe("Truth Inbox API", () => {
  beforeEach(() => apiJson.mockReset());

  it("uses one cacheable aggregate read with cursor filters", async () => {
    apiJson.mockResolvedValue({ items: [] });
    await getTruthInbox("project-1", { category: "spec_drift", status: "active", owner: "me", cursor: "next-page", limit: 25 });
    expect(apiJson).toHaveBeenCalledWith("/v1/projects/project-1/truth-inbox?category=spec_drift&status=active&owner=me&cursor=next-page&limit=25");
  });

  it("encodes cross-source item ids and preserves structured action input", async () => {
    apiJson.mockResolvedValue({ item: null });
    await actOnTruthInboxItem("project-1", "suggestion:sug signal", "request_clarification", { note: "Which launch is affected?" });
    expect(apiJson).toHaveBeenCalledWith(
      "/v1/projects/project-1/truth-inbox/suggestion%3Asug%20signal/actions/request_clarification",
      { method: "POST", body: JSON.stringify({ note: "Which launch is affected?" }) }
    );
  });

  it("loads one cacheable packet contract for an encoded item id", async () => {
    apiJson.mockResolvedValue({ id: "packet-1" });
    await getTruthChangePacket("project-1", "proposal:change one");
    expect(apiJson).toHaveBeenCalledWith("/v1/projects/project-1/truth-inbox/proposal%3Achange%20one/packet");
  });
});
