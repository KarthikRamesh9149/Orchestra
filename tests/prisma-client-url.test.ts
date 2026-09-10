import { afterEach, describe, expect, it } from "vitest";
import { buildRuntimeDatabaseUrl } from "../src/db/prisma.js";

const originalConnectionLimit = process.env.PRISMA_CONNECTION_LIMIT;
const originalPoolTimeout = process.env.PRISMA_POOL_TIMEOUT_SECONDS;

afterEach(() => {
  if (originalConnectionLimit === undefined) delete process.env.PRISMA_CONNECTION_LIMIT;
  else process.env.PRISMA_CONNECTION_LIMIT = originalConnectionLimit;
  if (originalPoolTimeout === undefined) delete process.env.PRISMA_POOL_TIMEOUT_SECONDS;
  else process.env.PRISMA_POOL_TIMEOUT_SECONDS = originalPoolTimeout;
});

describe("Prisma runtime database URL", () => {
  it("adds conservative pool limits when DATABASE_URL omits them", () => {
    const next = buildRuntimeDatabaseUrl("postgresql://user:pass@db.example.com:5432/postgres");
    const parsed = new URL(next!);

    expect(parsed.searchParams.get("connection_limit")).toBe("3");
    expect(parsed.searchParams.get("pool_timeout")).toBe("20");
  });

  it("preserves explicit pool settings from the deployment URL", () => {
    const next = buildRuntimeDatabaseUrl("postgresql://user:pass@db.example.com:5432/postgres?connection_limit=7&pool_timeout=9");
    const parsed = new URL(next!);

    expect(parsed.searchParams.get("connection_limit")).toBe("7");
    expect(parsed.searchParams.get("pool_timeout")).toBe("9");
  });

  it("allows deployment env overrides for the default pool limits", () => {
    process.env.PRISMA_CONNECTION_LIMIT = "2";
    process.env.PRISMA_POOL_TIMEOUT_SECONDS = "12";
    const next = buildRuntimeDatabaseUrl("postgresql://user:pass@db.example.com:5432/postgres");
    const parsed = new URL(next!);

    expect(parsed.searchParams.get("connection_limit")).toBe("2");
    expect(parsed.searchParams.get("pool_timeout")).toBe("12");
  });
});
