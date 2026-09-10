import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWatchtowerReview, dismissWatchtowerSuggestion, getWatchtowerFde, getWatchtowerSuggestions, promoteWatchtowerSuggestion } from "./api/watchtower";

const apiJson = vi.fn();
vi.mock("./api/client", () => ({ apiJson: (...args: unknown[]) => apiJson(...args) }));

describe("[FIX-23] Watchtower API", () => {
  beforeEach(() => apiJson.mockReset());
  it("loads authoritative suggestions including persisted action states", async () => {
    apiJson.mockResolvedValue({ items: [] });
    await getWatchtowerSuggestions("project-1");
    expect(apiJson).toHaveBeenCalledWith("/v1/projects/project-1/suggestions?includeDismissed=true&refresh=true&limit=100");
  });
  it("uses only the protected suggestion mutation contracts", async () => {
    apiJson.mockResolvedValue({});
    await dismissWatchtowerSuggestion("project-1", "signal-1", "reviewed");
    await promoteWatchtowerSuggestion("project-1", "signal-1");
    await createWatchtowerReview("project-1", "signal-1");
    expect(apiJson).toHaveBeenNthCalledWith(1, "/v1/projects/project-1/suggestions/signal-1/dismiss", expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "reviewed" }) }));
    expect(apiJson).toHaveBeenNthCalledWith(2, "/v1/projects/project-1/suggestions/signal-1/promote-to-timeline", { method: "POST" });
    expect(apiJson).toHaveBeenNthCalledWith(3, "/v1/projects/project-1/suggestions/signal-1/create-review-item", { method: "POST" });
  });
  it("combines conflict and Safe-to-Touch evidence as read-only intelligence", async () => {
    apiJson.mockResolvedValueOnce({ items: [{ id: "conflict" }], limitations: [] }).mockResolvedValueOnce({ items: [{ id: "safe" }], limitations: [] });
    const result = await getWatchtowerFde("project-1");
    expect(result.items).toEqual([{ id: "conflict" }, { id: "safe" }]);
    expect(result.truthMutationAllowed).toBe(false);
  });
});
