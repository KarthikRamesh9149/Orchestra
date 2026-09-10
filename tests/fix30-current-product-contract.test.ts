import { describe, expect, it } from "vitest";
import { validateCurrentProductContracts } from "../scripts/docs/validate-current-product-contracts.js";

describe("Fix 30 current-product contract", () => {
  it("keeps frontend routes, API families, Prisma, Supabase, generated schema, and maintained docs aligned", () => {
    expect(validateCurrentProductContracts()).toEqual({
      routes: 14,
      redirects: 8,
      contractFamilies: 10,
      modelCount: 101,
      enumCount: 106,
      migrationCount: 81,
      routeCount: 405,
    });
  });
});
