import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error The standalone qualification script has no TypeScript declarations.
import { parseRecoveryArgs, preservedEarlierMessages } from "../scripts/desktop/qualify-isolated-ai-recovery.mjs";

describe("isolated AI recovery pure helpers", () => {
  describe("parseRecoveryArgs", () => {
    it("defaults only to this checkout's absolute build paths", () => {
      const repository = fileURLToPath(new URL("..", import.meta.url));
      const options = parseRecoveryArgs([]);

      expect(options).toEqual({
        bundle: resolve(repository, ".desktop/runtime"),
        dist: resolve(repository, "dist")
      });
      expect(Object.values(options).every(value => isAbsolute(value as string))).toBe(true);
    });

    it("accepts each supported absolute build path in either order", () => {
      expect(parseRecoveryArgs([
        "--backend-dist", "/private/tmp/synthetic build/dist",
        "--bundle", "/private/tmp/synthetic build/runtime/../runtime"
      ])).toEqual({
        bundle: "/private/tmp/synthetic build/runtime",
        dist: "/private/tmp/synthetic build/dist"
      });
    });

    it.each([
      ["--profile", "/private/tmp/existing-profile"],
      ["--key-file", "/private/tmp/provider.env"],
      ["--database-url", "/private/tmp/database"],
      ["--provider", "/private/tmp/provider"],
      ["--bundle", "relative/runtime"],
      ["--backend-dist", "~/dist"],
      ["--bundle"],
      ["--backend-dist", ""],
      ["--bundle", "/private/tmp/runtime", "--bundle", "/private/tmp/other"],
      ["--backend-dist", "/private/tmp/dist", "--backend-dist", "/private/tmp/other"],
      ["--bundle", "/private/tmp/runtime", "extra"],
      ["--bundle=/private/tmp/runtime"]
    ])("rejects unsupported, incomplete, repeated or nonabsolute arguments: %j", (...argv) => {
      expect(() => parseRecoveryArgs(argv)).toThrow("Only absolute --bundle and --backend-dist arguments are allowed.");
    });
  });

  describe("preservedEarlierMessages", () => {
    const earlier = [
      { id: "user-1", sessionId: "session-1", role: "user", content: "Synthetic question", responseStatus: "completed" },
      { id: "assistant-1", sessionId: "session-1", role: "assistant", content: "Synthetic cited answer [E1]", responseStatus: "completed", payloadHash: "original-payload" }
    ];

    it("allows appended turns and reordered rows while requiring unchanged earlier messages", () => {
      const before = structuredClone(earlier);
      const after = [
        structuredClone(earlier[1]),
        structuredClone(earlier[0]),
        { id: "user-2", content: "Synthetic follow-up" },
        { id: "assistant-2", content: "Response stopped.", responseStatus: "failed", cancelled: true }
      ];

      expect(preservedEarlierMessages(before, after)).toBe(true);
      expect(before).toEqual(earlier);
      expect(after).toHaveLength(4);
    });

    it("rejects removal or replacement even when total message count is preserved", () => {
      expect(preservedEarlierMessages(earlier, [earlier[0]])).toBe(false);
      expect(preservedEarlierMessages(earlier, [earlier[0], { ...earlier[1], id: "replacement" }])).toBe(false);
    });

    it.each([
      { content: "Overwritten answer" },
      { responseStatus: "failed" },
      { payloadHash: "changed-citations" },
      { sessionId: "different-session" },
      { cancelled: true }
    ])("rejects changed persisted evidence: %j", patch => {
      expect(preservedEarlierMessages(earlier, [earlier[0], { ...earlier[1], ...patch }])).toBe(false);
    });

    it("accepts an empty baseline without claiming any earlier-turn coverage", () => {
      expect(preservedEarlierMessages([], [])).toBe(true);
      expect(preservedEarlierMessages([], earlier)).toBe(true);
    });
  });
});
