import { describe, expect, it, vi } from "vitest";
import { createSocratesTurn } from "../src/modules/socrates/turn-store.js";

describe("durable first-turn storage", () => {
  it("creates a session and both message roles in one bound database statement", async () => {
    const row = { id: "session", createdAt: new Date(0), updatedAt: new Date(0), messages: [{ id: "user", role: "user" }, { id: "assistant", role: "assistant" }] };
    const db = { $queryRaw: vi.fn(async (_query: unknown) => [row]), socratesSession: { create: vi.fn(async () => row) } };
    const input = { projectId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", question: "Don't execute '); DROP TABLE users; --", viewerState: { source: "socrates_v1" } };
    expect(await createSocratesTurn(db as any, input)).toEqual(row);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const query = db.$queryRaw.mock.calls[0][0] as any;
    expect(query.values).toEqual(expect.arrayContaining([input.projectId, input.userId, input.question]));
    expect(query.strings.join("")).not.toContain(input.question);
    expect(db.socratesSession.create).not.toHaveBeenCalled();
  });
  it("propagates transaction failure without claiming durable message IDs", async () => {
    const db = { $queryRaw: vi.fn(async () => { throw new Error("foreign key failed"); }) };
    await expect(createSocratesTurn(db as any, {projectId:"x",userId:"y",question:"q",viewerState:{}})).rejects.toThrow("foreign key failed");
  });
});
