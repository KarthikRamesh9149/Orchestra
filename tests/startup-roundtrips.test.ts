import { expect, it, vi } from "vitest";
import { MeService } from "../src/modules/me/me.service.js";

it("does not add serial relation round trips for an active organization with no projects", async () => {
  let roundTrips = 0;
  const prisma = {
    $queryRaw: vi.fn(async () => { roundTrips++; return []; }),
    organizationMembership: { findMany: vi.fn(async () => { roundTrips++; return [{ organizationId: "22222222-2222-4222-8222-222222222222" }]; }) },
    projectMember: { findMany: vi.fn(async () => { roundTrips++; return []; }) },
    refreshToken: { findFirst: vi.fn(async () => { roundTrips++; return null; }) }
  } as any;
  const result = await new MeService(prisma, {} as any).listWorkspaces({ userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222" }, "33333333-3333-4333-8333-333333333333");
  expect(result).toEqual([]);
  // A single parameterized query must enforce both memberships; a preliminary
  // membership read followed by nested relation reads reintroduces startup RTTs.
  expect(roundTrips).toBe(1);
});
