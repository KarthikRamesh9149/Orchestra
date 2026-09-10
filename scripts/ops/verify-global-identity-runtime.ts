import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

class RollbackProbe extends Error {}

const prisma = new PrismaClient();

function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function verifyCatalog() {
  const [table] = await prisma.$queryRaw<Array<{ rls: boolean; policies: bigint; triggers: bigint }>>`
    SELECT
      c.relrowsecurity AS rls,
      (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
      (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS triggers
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'organization_memberships'
  `;
  if (!table?.rls || table.policies < 2n) {
    throw new Error("organization_memberships must have RLS plus browser-denial and backend-role policies");
  }

  const [userTriggers] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'users' AND NOT t.tgisinternal
  `;
  if (!userTriggers || userTriggers.count < 2n) {
    throw new Error("legacy user compatibility triggers are missing");
  }
}

async function verifyLegacyWriterCompatibility() {
  const orgId = randomUUID();
  const userId = randomUUID();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "organizations" ("id", "name", "slug", "updated_at")
        VALUES (${orgId}::uuid, 'Identity probe', ${`identity-probe-${orgId}`} , CURRENT_TIMESTAMP)
      `;
      await tx.$executeRaw`
        INSERT INTO "users" (
          "id", "org_id", "email", "password_hash", "display_name",
          "global_role", "workspace_role_default", "updated_at"
        ) VALUES (
          ${userId}::uuid, ${orgId}::uuid, '  Probe@Example.COM  ', NULL, 'Probe',
          'member'::"GlobalRole", 'dev'::"WorkspaceRoleDefault", CURRENT_TIMESTAMP
        )
      `;

      const [identity] = await tx.$queryRaw<Array<{ email: string; normalizedEmail: string }>>`
        SELECT "email", "normalized_email" AS "normalizedEmail"
        FROM "users"
        WHERE "id" = ${userId}::uuid
      `;
      const [membership] = await tx.$queryRaw<Array<{ role: string; workspaceRole: string; active: boolean }>>`
        SELECT
          "global_role"::text AS role,
          "workspace_role_default"::text AS "workspaceRole",
          "is_active" AS active
        FROM "organization_memberships"
        WHERE "organization_id" = ${orgId}::uuid AND "user_id" = ${userId}::uuid
      `;
      if (identity?.email !== "probe@example.com" || identity.normalizedEmail !== identity.email) {
        throw new Error("legacy user write did not normalize global identity");
      }
      if (membership?.role !== "member" || membership.workspaceRole !== "dev" || !membership.active) {
        throw new Error("legacy user write did not create its organization membership");
      }
      throw new RollbackProbe("compatibility probe passed");
    });
  } catch (error) {
    if (error instanceof RollbackProbe) return;
    throw error;
  }
  throw new Error("compatibility probe did not roll back");
}

async function verifyGlobalDuplicateRejection() {
  const firstOrg = randomUUID();
  const secondOrg = randomUUID();
  const firstUser = randomUUID();
  const secondUser = randomUUID();
  let rejected = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "organizations" ("id", "name", "slug", "updated_at") VALUES
          (${firstOrg}::uuid, 'Identity probe one', ${`identity-probe-${firstOrg}`}, CURRENT_TIMESTAMP),
          (${secondOrg}::uuid, 'Identity probe two', ${`identity-probe-${secondOrg}`}, CURRENT_TIMESTAMP)
      `;
      await tx.$executeRaw`
        INSERT INTO "users" (
          "id", "org_id", "email", "display_name", "global_role", "workspace_role_default", "updated_at"
        ) VALUES (
          ${firstUser}::uuid, ${firstOrg}::uuid, 'duplicate@example.com', 'First',
          'member'::"GlobalRole", 'dev'::"WorkspaceRoleDefault", CURRENT_TIMESTAMP
        )
      `;
      await tx.$executeRaw`
        INSERT INTO "users" (
          "id", "org_id", "email", "display_name", "global_role", "workspace_role_default", "updated_at"
        ) VALUES (
          ${secondUser}::uuid, ${secondOrg}::uuid, ' DUPLICATE@EXAMPLE.COM ', 'Second',
          'member'::"GlobalRole", 'dev'::"WorkspaceRoleDefault", CURRENT_TIMESTAMP
        )
      `;
    });
  } catch (error) {
    const details = errorText(error);
    rejected = details.includes("23505") || details.includes("users_normalized_email_key");
    if (!rejected) throw error;
  }
  if (!rejected) throw new Error("normalized email was not globally unique across organizations");
}

async function main() {
  await verifyCatalog();
  await verifyLegacyWriterCompatibility();
  await verifyGlobalDuplicateRejection();
  console.log("Global identity runtime verification passed.");
}

main()
  .catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
