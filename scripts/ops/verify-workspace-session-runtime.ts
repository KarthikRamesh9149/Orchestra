import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../src/config/env.js";
import { hashPassword } from "../../src/lib/auth/password.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { AuthService } from "../../src/modules/auth/service.js";
import { MeService } from "../../src/modules/me/me.service.js";

const prisma = new PrismaClient();
const env = {
  JWT_ACCESS_SECRET: "workspace-runtime-access-secret-32-characters",
  JWT_REFRESH_SECRET: "workspace-runtime-refresh-secret-32-characters",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "30d",
  PASSWORD_HASH_COST: 4,
  SIGNUP_MODE: "invite_only",
  SIGNUP_ALLOWED_EMAIL_DOMAINS: ""
} as AppEnv;

type Fixture = { organizationIds: string[]; userId?: string; projectIds: string[] };

function tokenContext(token: string) {
  const payload = jwt.decode(token) as { sessionId?: string; orgId?: string; workspaceRoleDefault?: string } | null;
  if (!payload?.sessionId || !payload.orgId) throw new Error("workspace runtime token is missing session context");
  return payload;
}

async function verifyCatalog() {
  const [catalog] = await prisma.$queryRaw<Array<{ columns: bigint; indexes: bigint; constraint: bigint; trigger: bigint }>>`
    SELECT
      (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
         AND column_name IN ('active_project_id', 'device_label', 'device_type', 'user_agent_hash', 'ip_address_hash', 'ip_label', 'last_used_at')) AS columns,
      (SELECT count(*) FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'refresh_tokens'
         AND indexname IN ('refresh_tokens_active_project_id_idx', 'refresh_tokens_user_active_last_used_idx')) AS indexes,
      (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.refresh_tokens'::regclass
         AND conname = 'refresh_tokens_active_project_id_fkey' AND convalidated = TRUE) AS constraint,
      (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.refresh_tokens'::regclass
         AND tgname = 'refresh_tokens_active_project_guard' AND NOT tgisinternal) AS trigger
  `;
  if (!catalog || catalog.columns !== 7n || catalog.indexes !== 2n || catalog.constraint !== 1n || catalog.trigger !== 1n) {
    throw new Error("Fix 10 database catalog is incomplete");
  }
}

async function createFixture(fixture: Fixture) {
  const [firstOrg, secondOrg] = await Promise.all([
    prisma.organization.create({ data: { name: "Workspace runtime one", slug: `workspace-runtime-one-${randomUUID()}` } }),
    prisma.organization.create({ data: { name: "Workspace runtime two", slug: `workspace-runtime-two-${randomUUID()}` } })
  ]);
  fixture.organizationIds.push(firstOrg.id, secondOrg.id);
  const email = `workspace-runtime-${randomUUID()}@example.com`;
  const password = "RuntimePassword123!";
  const user = await prisma.user.create({
    data: {
      orgId: firstOrg.id,
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword(password, env.PASSWORD_HASH_COST),
      displayName: "Workspace Runtime",
      globalRole: "owner",
      workspaceRoleDefault: "manager"
    }
  });
  fixture.userId = user.id;
  await prisma.organizationMembership.createMany({
    data: [
      { organizationId: firstOrg.id, userId: user.id, globalRole: "owner", workspaceRoleDefault: "manager", isActive: true },
      { organizationId: secondOrg.id, userId: user.id, globalRole: "member", workspaceRoleDefault: "client", isActive: true }
    ],
    skipDuplicates: true
  });
  const [firstProject, secondProject] = await Promise.all([
    prisma.project.create({ data: { orgId: firstOrg.id, name: "Internal runtime", slug: `internal-${randomUUID()}`, status: "active", createdBy: user.id } }),
    prisma.project.create({ data: { orgId: secondOrg.id, name: "Client runtime", slug: `client-${randomUUID()}`, status: "active", createdBy: user.id } })
  ]);
  fixture.projectIds.push(firstProject.id, secondProject.id);
  await prisma.projectMember.createMany({
    data: [
      { projectId: firstProject.id, userId: user.id, projectRole: "manager", canApproveTruthChanges: true, isActive: true },
      { projectId: secondProject.id, userId: user.id, projectRole: "client", canApproveTruthChanges: false, isActive: true }
    ]
  });
  return { user, email, password, firstOrg, secondOrg, firstProject, secondProject };
}

async function verifyRuntime(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const audit = new AuditService(prisma);
  const auth = new AuthService(prisma, env, audit);
  const me = new MeService(prisma, audit);
  const login = await auth.login(
    { email: fixture.email, password: fixture.password, sessionMode: "browser" },
    { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36", ipAddress: "203.0.113.10" }
  );
  const initial = tokenContext(login.accessToken);
  const workspace = await me.switchWorkspace(
    { userId: fixture.user.id, orgId: fixture.firstOrg.id },
    fixture.secondProject.id
  );
  const switched = await auth.switchSessionContext({
    userId: fixture.user.id,
    currentOrgId: fixture.firstOrg.id,
    targetOrgId: fixture.secondOrg.id,
    projectId: fixture.secondProject.id,
    sessionId: initial.sessionId,
    requestMetadata: { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36", ipAddress: "203.0.113.10" }
  });
  const context = tokenContext(switched.accessToken);
  if (workspace.role !== "client" || context.orgId !== fixture.secondOrg.id || context.workspaceRoleDefault !== "client") {
    throw new Error("cross-organization client role was not preserved");
  }
  await auth.assertSessionActive(initial.sessionId, fixture.user.id, fixture.secondOrg.id);
  try {
    await auth.assertSessionActive(initial.sessionId, fixture.user.id, fixture.firstOrg.id);
    throw new Error("old organization access remained active after switch");
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "session_revoked") throw error;
  }

  const workspaces = await me.listWorkspaces({ userId: fixture.user.id, orgId: fixture.secondOrg.id }, initial.sessionId);
  const current = workspaces.filter((item) => item.current);
  if (workspaces.length !== 2 || current.length !== 1 || current[0]?.projectId !== fixture.secondProject.id) {
    throw new Error("server-authoritative workspace selection did not survive reload query");
  }
  const profile = await me.getProfile({ userId: fixture.user.id, orgId: fixture.secondOrg.id }, initial.sessionId);
  if (profile.emailVerified || profile.workspaceRoleDefault !== "client" || profile.activeProjectId !== fixture.secondProject.id) {
    throw new Error("profile verification, role, or active project is not authoritative");
  }
  const rotated = await auth.refresh(switched.refreshToken, "browser");
  const sessions = await me.listSessions({ userId: fixture.user.id, orgId: fixture.secondOrg.id }, initial.sessionId);
  if (sessions.length !== 1 || sessions[0]?.deviceType !== "laptop" || !sessions[0].ipLabel || sessions[0].id !== initial.sessionId) {
    throw new Error("device metadata or rotated-family deduplication failed");
  }
  await auth.logout(rotated.refreshToken);
  const afterLogout = await me.listSessions({ userId: fixture.user.id, orgId: fixture.secondOrg.id }, initial.sessionId);
  if (afterLogout.length !== 0) throw new Error("revoked session remained in the active session list");
}

async function cleanup(fixture: Fixture) {
  if (fixture.userId) {
    await prisma.auditEvent.deleteMany({ where: { actorUserId: fixture.userId } });
    await prisma.refreshToken.deleteMany({ where: { userId: fixture.userId } });
    await prisma.projectMember.deleteMany({ where: { userId: fixture.userId } });
  }
  if (fixture.projectIds.length) await prisma.project.deleteMany({ where: { id: { in: fixture.projectIds } } });
  if (fixture.userId) {
    await prisma.organizationMembership.deleteMany({ where: { userId: fixture.userId } });
    await prisma.user.deleteMany({ where: { id: fixture.userId } });
  }
  if (fixture.organizationIds.length) await prisma.organization.deleteMany({ where: { id: { in: fixture.organizationIds } } });
}

async function main() {
  const fixture: Fixture = { organizationIds: [], projectIds: [] };
  try {
    await verifyCatalog();
    await verifyRuntime(await createFixture(fixture));
    console.log("Workspace, role, verification, and session metadata runtime verification passed.");
  } finally {
    await cleanup(fixture);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
