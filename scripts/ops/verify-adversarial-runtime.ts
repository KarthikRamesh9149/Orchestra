import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function fail(message: string): never {
  throw new Error(message);
}

async function main() {
  const slug = `fix34-${randomUUID()}`;
  const organization = await prisma.organization.create({ data: { name: "Fix 34 adversarial runtime", slug } });
  const email = `${slug}@example.test`;
  const user = await prisma.user.create({
    data: {
      orgId: organization.id,
      email,
      normalizedEmail: email,
      displayName: "Fix 34 Runtime",
      globalRole: "owner",
      workspaceRoleDefault: "manager"
    }
  });
  try {
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      create: { organizationId: organization.id, userId: user.id, globalRole: "owner", workspaceRoleDefault: "manager" },
      update: { globalRole: "owner", workspaceRoleDefault: "manager", isActive: true }
    });
    const state = await prisma.gitHubOAuthState.create({
      data: {
        orgId: organization.id,
        actorUserId: user.id,
        purpose: "installation",
        nonceHash: createHash("sha256").update(randomUUID()).digest("hex"),
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    const claims = await Promise.all([
      prisma.gitHubOAuthState.updateMany({ where: { id: state.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } }),
      prisma.gitHubOAuthState.updateMany({ where: { id: state.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
    ]);
    if (claims.filter((claim) => claim.count === 1).length !== 1 || claims.reduce((sum, claim) => sum + claim.count, 0) !== 1) {
      fail("OAuth state replay fencing did not produce exactly one winner");
    }

    const [catalog] = await prisma.$queryRaw<Array<{ rls: boolean; purposeCheck: boolean; backendPolicy: boolean }>>`
      SELECT
        COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.github_oauth_states'::regclass), FALSE) AS rls,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.github_oauth_states'::regclass
            AND conname = 'github_oauth_states_purpose_check' AND convalidated = TRUE
        ) AS "purposeCheck",
        EXISTS (
          SELECT 1 FROM pg_policy
          WHERE polrelid = 'public.github_oauth_states'::regclass
            AND polname = 'backend_database_role_full_access'
            AND pg_get_expr(polqual, polrelid) = 'true'
            AND pg_get_expr(polwithcheck, polrelid) = 'true'
        ) AS "backendPolicy"
    `;
    if (!catalog?.rls || !catalog.purposeCheck || !catalog.backendPolicy) fail("OAuth state database boundary is incomplete");
    console.log("Fix 34 adversarial runtime verification passed: durable state, RLS, purpose guard, and one-winner replay fencing.");
  } finally {
    await prisma.gitHubOAuthState.deleteMany({ where: { orgId: organization.id } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
