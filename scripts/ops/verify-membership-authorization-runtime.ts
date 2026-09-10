import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

class RollbackProbe extends Error {}

const prisma = new PrismaClient();

function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function verifyCatalog() {
  const [catalog] = await prisma.$queryRaw<
    Array<{
      authorizationIndex: string | null;
      clientConstraint: boolean;
      tenantTrigger: boolean;
      anonCanExecute: boolean;
      authenticatedCanExecute: boolean;
    }>
  >`
    SELECT
      to_regclass('public.project_members_user_id_is_active_project_id_idx')::text AS "authorizationIndex",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.project_members'::regclass
          AND conname = 'project_members_client_truth_approval_check'
          AND convalidated = TRUE
      ) AS "clientConstraint",
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.project_members'::regclass
          AND tgname = 'project_members_require_active_organization_membership'
          AND NOT tgisinternal
      ) AS "tenantTrigger",
      has_function_privilege(
        'anon',
        'public.enforce_project_member_organization_membership()',
        'EXECUTE'
      ) AS "anonCanExecute",
      has_function_privilege(
        'authenticated',
        'public.enforce_project_member_organization_membership()',
        'EXECUTE'
      ) AS "authenticatedCanExecute"
  `;
  if (
    !catalog?.authorizationIndex ||
    !catalog.clientConstraint ||
    !catalog.tenantTrigger ||
    catalog.anonCanExecute ||
    catalog.authenticatedCanExecute
  ) {
    throw new Error("membership authorization catalog or function-execution boundary is invalid");
  }
}

async function createOrganizationAndUser(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  label: string
) {
  const orgId = randomUUID();
  const userId = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "organizations" ("id", "name", "slug", "updated_at")
    VALUES (${orgId}::uuid, ${label}, ${`authorization-${label.toLowerCase().replace(/\s+/g, "-")}-${orgId}`}, CURRENT_TIMESTAMP)
  `;
  await tx.$executeRaw`
    INSERT INTO "users" (
      "id", "org_id", "email", "display_name", "global_role", "workspace_role_default", "updated_at"
    ) VALUES (
      ${userId}::uuid, ${orgId}::uuid, ${`${userId}@example.com`}, ${label},
      'member'::"GlobalRole", 'dev'::"WorkspaceRoleDefault", CURRENT_TIMESTAMP
    )
  `;
  return { orgId, userId };
}

async function createProject(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  orgId: string,
  creatorUserId: string,
  label: string
) {
  const projectId = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "projects" (
      "id", "org_id", "name", "slug", "status", "created_by", "updated_at"
    ) VALUES (
      ${projectId}::uuid, ${orgId}::uuid, ${label}, ${`authorization-${projectId}`},
      'active'::"ProjectStatus", ${creatorUserId}::uuid, CURRENT_TIMESTAMP
    )
  `;
  return projectId;
}

async function verifySameOrganizationMembershipAccepted() {
  try {
    await prisma.$transaction(async (tx) => {
      const { orgId, userId } = await createOrganizationAndUser(tx, "Same organization");
      const projectId = await createProject(tx, orgId, userId, "Same organization project");
      await tx.$executeRaw`
        INSERT INTO "project_members" (
          "id", "project_id", "user_id", "project_role", "can_approve_truth_changes", "updated_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${projectId}::uuid, ${userId}::uuid,
          'manager'::"ProjectRole", TRUE, CURRENT_TIMESTAMP
        )
      `;
      throw new RollbackProbe("same-organization authorization probe passed");
    });
  } catch (error) {
    if (error instanceof RollbackProbe) return;
    throw error;
  }
}

async function verifyCrossTenantMembershipRejected() {
  let rejected = false;
  try {
    await prisma.$transaction(async (tx) => {
      const owner = await createOrganizationAndUser(tx, "Project owner");
      const outsider = await createOrganizationAndUser(tx, "Cross tenant outsider");
      const projectId = await createProject(tx, owner.orgId, owner.userId, "Tenant boundary project");
      await tx.$executeRaw`
        INSERT INTO "project_members" (
          "id", "project_id", "user_id", "project_role", "can_approve_truth_changes", "updated_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${projectId}::uuid, ${outsider.userId}::uuid,
          'dev'::"ProjectRole", FALSE, CURRENT_TIMESTAMP
        )
      `;
    });
  } catch (error) {
    const details = errorText(error);
    rejected = details.includes("23514") || details.includes("Active organization membership required");
    if (!rejected) throw error;
  }
  if (!rejected) throw new Error("cross-tenant project membership was accepted");
}

async function verifyClientTruthApprovalRejected() {
  let rejected = false;
  try {
    await prisma.$transaction(async (tx) => {
      const { orgId, userId } = await createOrganizationAndUser(tx, "Client approval");
      const projectId = await createProject(tx, orgId, userId, "Client approval project");
      await tx.$executeRaw`
        INSERT INTO "project_members" (
          "id", "project_id", "user_id", "project_role", "can_approve_truth_changes", "updated_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${projectId}::uuid, ${userId}::uuid,
          'client'::"ProjectRole", TRUE, CURRENT_TIMESTAMP
        )
      `;
    });
  } catch (error) {
    const details = errorText(error);
    rejected = details.includes("23514") || details.includes("project_members_client_truth_approval_check");
    if (!rejected) throw error;
  }
  if (!rejected) throw new Error("client truth-approval membership was accepted");
}

async function main() {
  await verifyCatalog();
  await verifySameOrganizationMembershipAccepted();
  await verifyCrossTenantMembershipRejected();
  await verifyClientTruthApprovalRejected();
  console.log("Centralized membership authorization runtime verification passed.");
}

main()
  .catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
