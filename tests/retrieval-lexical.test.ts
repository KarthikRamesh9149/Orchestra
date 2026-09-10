import { describe, expect, it } from "vitest";
import { buildRecallPreservingWebsearchQuery } from "../src/lib/retrieval/lexical.js";

describe("buildRecallPreservingWebsearchQuery", () => {
  it("removes source scaffolding and uses recall-preserving OR semantics", () => {
    expect(buildRecallPreservingWebsearchQuery("What did Slack say about OAuth replay?"))
      .toBe("oauth OR replay");
    expect(buildRecallPreservingWebsearchQuery("Find GitHub evidence for citation validation"))
      .toBe("citation OR validation");
  });

  it("returns an empty query when no meaningful search terms remain", () => {
    expect(buildRecallPreservingWebsearchQuery("What does GitHub show?"))
      .toBe("");
  });
});
