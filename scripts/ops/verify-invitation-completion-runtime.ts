import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../src/config/env.js";
import { verifyPassword, hashPassword } from "../../src/lib/auth/password.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { AuthService } from "../../src/modules/auth/service.js";
import {
  generateProjectJoinCode,
  getProjectJoinCodePrefix,
  hashProjectJoinCode
} from "../../src/modules/projects/join-codes.js";

const prisma = new PrismaClient();
const env = {
  JWT_ACCESS_SECRET: "invitation-runtime-access-secret-32-characters",
  JWT_REFRESH_SECRET: "invitation-runtime-refresh-secret-32-characters",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "30d",
  PASSWORD_HASH_COST: 4,
  SIGNUP_MODE: "invite_only",
  SIGNUP_ALLOWED_EMAIL_DOMAINS: ""
} as AppEnv;

type Fixture = {
  organizationIds: string[];
  projectIds: string[];
  joinCodeIds: string[];
  userIds: string[];
};

function errorText(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function verifyCatalog() {
  const [catalog] = await prisma.$queryRaw<
    Array<{
      tableName: string | null;
      rls: boolean;
      emailConstraint: boolean;
      normalizedEmailConstraint: boolean;
      singleUseConstraint: boolean;
      usageConstraint: boolean;
      codeUserUnique: boolean;
      projectUserUnique: boolean;
      browserDenyPolicy: boolean;
      backendCodePolicy: boolean;
      backendRedemptionPolicy: boolean;
    }>
  >`
    SELECT
      to_regclass('public.project_join_code_redemptions')::text AS "tableName",
      COALESCE((
        SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.project_join_code_redemptions')
      ), FALSE) AS rls,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.project_join_codes'::regclass
          AND conname = 'project_join_codes_email_bound_or_revoked_check'
          AND convalidated = TRUE
      ) AS "emailConstraint",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.project_join_codes'::regclass
          AND conname = 'project_join_codes_normalized_email_check'
          AND convalidated = TRUE
      ) AS "normalizedEmailConstraint",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.project_join_codes'::regclass
          AND conname = 'project_join_codes_single_use_or_revoked_check'
          AND convalidated = TRUE
      ) AS "singleUseConstraint",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.project_join_codes'::regclass
          AND conname = 'project_join_codes_usage_bounds_check'
          AND convalidated = TRUE
      ) AS "usageConstraint",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.project_join_code_redemptions'::regclass
          AND conname = 'project_join_code_redemptions_join_code_id_key'
      ) AS "codeUserUnique",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.project_join_code_redemptions'::regclass
          AND conname = 'project_join_code_redemptions_project_id_user_id_key'
      ) AS "projectUserUnique",
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'project_join_code_redemptions'
          AND policyname = 'backend_api_only_no_direct_client_access'
          AND permissive = 'RESTRICTIVE'
          AND roles @> ARRAY['anon', 'authenticated']::name[]
          AND qual = 'false'
          AND with_check = 'false'
      ) AS "browserDenyPolicy"
      , EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.project_join_codes'::regclass
          AND polname = 'backend_database_role_full_access'
          AND polpermissive = TRUE
          AND (SELECT oid FROM pg_roles WHERE rolname = current_user) = ANY(polroles)
          AND pg_get_expr(polqual, polrelid) = 'true'
          AND pg_get_expr(polwithcheck, polrelid) = 'true'
      ) AS "backendCodePolicy"
      , EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.project_join_code_redemptions'::regclass
          AND polname = 'backend_database_role_full_access'
          AND polpermissive = TRUE
          AND (SELECT oid FROM pg_roles WHERE rolname = current_user) = ANY(polroles)
          AND pg_get_expr(polqual, polrelid) = 'true'
          AND pg_get_expr(polwithcheck, polrelid) = 'true'
      ) AS "backendRedemptionPolicy"
  `;

  if (
    !catalog?.tableName ||
    !catalog.rls ||
    !catalog.emailConstraint ||
    !catalog.normalizedEmailConstraint ||
    !catalog.singleUseConstraint ||
    !catalog.usageConstraint ||
    !catalog.codeUserUnique ||
    !catalog.projectUserUnique ||
    !catalog.browserDenyPolicy ||
    !catalog.backendCodePolicy ||
    !catalog.backendRedemptionPolicy
  ) {
    throw new Error("durable invitation catalog, constraints, or browser-access boundary is invalid");
  }
}

async function createOrganization(label: string, fixture: Fixture) {
  const organization = await prisma.organization.create({
    data: { name: label, slug: `invite-runtime-${randomUUID()}` }
  });
  fixture.organizationIds.push(organization.id);
  return organization;
}

async function createUser(
  organizationId: string,
  email: string,
  displayName: string,
  fixture: Fixture,
  passwordHash: string | null = null
) {
  const user = await prisma.user.create({
    data: {
      orgId: organizationId,
      email,
      normalizedEmail: email,
      passwordHash,
      displayName,
      globalRole: "member",
      workspaceRoleDefault: "manager"
    }
  });
  fixture.userIds.push(user.id);
  return user;
}

async function createInvite(
  targetEmail: string,
  fixture: Fixture
) {
  const organization = await createOrganization("Invitation runtime target", fixture);
  const inviter = await createUser(
    organization.id,
    `inviter-${randomUUID()}@example.com`,
    "Invitation runtime inviter",
    fixture
  );
  const project = await prisma.project.create({
    data: {
      orgId: organization.id,
      name: "Invitation runtime project",
      slug: `invite-runtime-project-${randomUUID()}`,
      status: "active",
      createdBy: inviter.id
    }
  });
  fixture.projectIds.push(project.id);
  const code = generateProjectJoinCode();
  const joinCode = await prisma.projectJoinCode.create({
    data: {
      projectId: project.id,
      orgId: organization.id,
      codeHash: hashProjectJoinCode(code),
      codePrefix: getProjectJoinCodePrefix(code),
      projectRole: "dev",
      canApproveTruthChanges: false,
      maxUses: 1,
      useCount: 0,
      invitedEmail: targetEmail,
      emailDeliveryStatus: "sent",
      expiresAt: new Date(Date.now() + 10 * 60_000),
      createdBy: inviter.id
    }
  });
  fixture.joinCodeIds.push(joinCode.id);
  return { organization, project, code, joinCode };
}

async function verifyNewAccountCompletion(fixture: Fixture) {
  const email = `new-invitee-${randomUUID()}@example.com`;
  const invite = await createInvite(email, fixture);
  const authService = new AuthService(prisma, env, new AuditService(prisma));
  const input = {
    email,
    code: invite.code,
    password: "RuntimePassword123!",
    displayName: "Runtime New Invitee"
  };

  const attempts = await Promise.allSettled([
    authService.completeInvitationAccount(input),
    authService.completeInvitationAccount(input)
  ]);
  const successes = attempts.filter((result) => result.status === "fulfilled");
  const failures = attempts.filter((result) => result.status === "rejected");
  if (successes.length !== 1 || failures.length !== 1) {
    throw new Error("concurrent new-account redemption was not exactly-once");
  }

  const result = (successes[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof authService.completeInvitationAccount>>>).value;
  fixture.userIds.push(result.user.id);
  const [user, membership, projectMember, redemption, refreshedCode] = await Promise.all([
    prisma.user.findUnique({ where: { id: result.user.id } }),
    prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: invite.organization.id, userId: result.user.id } }
    }),
    prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: invite.project.id, userId: result.user.id } }
    }),
    prisma.projectJoinCodeRedemption.findUnique({
      where: { projectId_userId: { projectId: invite.project.id, userId: result.user.id } }
    }),
    prisma.projectJoinCode.findUnique({ where: { id: invite.joinCode.id } })
  ]);
  const token = jwt.decode(result.accessToken) as { orgId?: string; userId?: string } | null;

  if (
    !user?.passwordHash ||
    user.emailVerifiedAt !== null ||
    !(await verifyPassword(input.password, user.passwordHash)) ||
    !membership?.isActive ||
    !projectMember?.isActive ||
    !redemption ||
    refreshedCode?.useCount !== 1 ||
    result.invitation.projectId !== invite.project.id ||
    token?.orgId !== invite.organization.id ||
    token.userId !== user.id
  ) {
    throw new Error("new-account invitation did not persist authoritative identity, membership, redemption, and session state");
  }

  await expectRejected(
    () => authService.redeemInvitationForExistingAccount({
      email,
      password: input.password,
      code: invite.code
    }),
    ["join_code_unavailable", "join_code_already_redeemed"]
  );
}

async function verifyExistingAccountCompletion(fixture: Fixture) {
  const email = `existing-invitee-${randomUUID()}@example.com`;
  const password = "ExistingRuntimePassword123!";
  const home = await createOrganization("Invitation runtime home", fixture);
  const existing = await createUser(
    home.id,
    email,
    "Runtime Existing Invitee",
    fixture,
    await hashPassword(password, env.PASSWORD_HASH_COST)
  );
  const invite = await createInvite(email, fixture);
  const authService = new AuthService(prisma, env, new AuditService(prisma));

  const result = await authService.redeemInvitationForExistingAccount({ email, password, code: invite.code });
  const [userCount, membership, projectMember, redemption, refreshedCode] = await Promise.all([
    prisma.user.count({ where: { normalizedEmail: email } }),
    prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: invite.organization.id, userId: existing.id } }
    }),
    prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: invite.project.id, userId: existing.id } }
    }),
    prisma.projectJoinCodeRedemption.findUnique({
      where: { projectId_userId: { projectId: invite.project.id, userId: existing.id } }
    }),
    prisma.projectJoinCode.findUnique({ where: { id: invite.joinCode.id } })
  ]);
  const token = jwt.decode(result.accessToken) as { orgId?: string; userId?: string } | null;

  if (
    userCount !== 1 ||
    !membership?.isActive ||
    !projectMember?.isActive ||
    !redemption ||
    refreshedCode?.useCount !== 1 ||
    result.user.id !== existing.id ||
    result.user.orgId !== invite.organization.id ||
    token?.orgId !== invite.organization.id ||
    token.userId !== existing.id
  ) {
    throw new Error("existing-account invitation did not persist one global identity and target-organization membership");
  }
}

async function expectRejected(action: () => Promise<unknown>, acceptedCodes: string[]) {
  try {
    await action();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (acceptedCodes.includes(code)) return;
    throw error;
  }
  throw new Error("expected invitation action to be rejected");
}

async function cleanup(fixture: Fixture) {
  await prisma.$transaction(async (tx) => {
    await tx.auditEvent.deleteMany({ where: { orgId: { in: fixture.organizationIds } } });
    await tx.refreshToken.deleteMany({ where: { userId: { in: fixture.userIds } } });
    await tx.projectJoinCodeRedemption.deleteMany({ where: { joinCodeId: { in: fixture.joinCodeIds } } });
    await tx.projectMember.deleteMany({ where: { projectId: { in: fixture.projectIds } } });
    await tx.projectJoinCode.deleteMany({ where: { id: { in: fixture.joinCodeIds } } });
    await tx.project.deleteMany({ where: { id: { in: fixture.projectIds } } });
    await tx.organizationMembership.deleteMany({ where: { userId: { in: fixture.userIds } } });
    await tx.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await tx.organization.deleteMany({ where: { id: { in: fixture.organizationIds } } });
  });
}

async function main() {
  const fixture: Fixture = { organizationIds: [], projectIds: [], joinCodeIds: [], userIds: [] };
  try {
    await verifyCatalog();
    await verifyNewAccountCompletion(fixture);
    await verifyExistingAccountCompletion(fixture);
    console.log("Durable invitation completion runtime verification passed.");
  } finally {
    await cleanup(fixture);
  }
}

main()
  .catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
