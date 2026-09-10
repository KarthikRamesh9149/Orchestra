import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../src/config/env.js";
import { hashToken } from "../../src/lib/auth/jwt.js";
import { hashPassword } from "../../src/lib/auth/password.js";
import { AuthService } from "../../src/modules/auth/service.js";

const prisma = new PrismaClient();
const env = {
  JWT_ACCESS_SECRET: "session-runtime-access-secret-32-characters",
  JWT_REFRESH_SECRET: "session-runtime-refresh-secret-32-characters",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "30d",
  PASSWORD_HASH_COST: 4,
  SIGNUP_MODE: "invite_only",
  SIGNUP_ALLOWED_EMAIL_DOMAINS: ""
} as AppEnv;

type Fixture = { organizationId?: string; userId?: string };

function errorText(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function tokenSessionId(token: string) {
  const payload = jwt.decode(token) as { sessionId?: string; typ?: string } | null;
  if (!payload?.sessionId) throw new Error("issued JWT is missing its durable session id");
  return { sessionId: payload.sessionId, typ: payload.typ };
}

async function expectCode(action: () => Promise<unknown>, expectedCode: string) {
  try {
    await action();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === expectedCode) return;
    throw error;
  }
  throw new Error(`expected ${expectedCode}`);
}

async function verifyCatalog() {
  const [catalog] = await prisma.$queryRaw<Array<{
    sessionId: boolean;
    parentFk: boolean;
    clientConstraint: boolean;
    rotationConstraint: boolean;
    activeIndex: boolean;
    orgIndex: boolean;
    rls: boolean;
    browserDenyPolicy: boolean;
    backendPolicy: boolean;
  }>>`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
          AND column_name = 'session_id' AND is_nullable = 'NO'
      ) AS "sessionId",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.refresh_tokens'::regclass
          AND conname = 'refresh_tokens_parent_token_id_fkey'
      ) AS "parentFk",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.refresh_tokens'::regclass
          AND conname = 'refresh_tokens_client_type_check' AND convalidated = TRUE
      ) AS "clientConstraint",
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.refresh_tokens'::regclass
          AND conname = 'refresh_tokens_rotation_state_check' AND convalidated = TRUE
      ) AS "rotationConstraint",
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'refresh_tokens'
          AND indexname = 'refresh_tokens_session_id_active_idx'
          AND indexdef ILIKE '%WHERE (revoked_at IS NULL)%'
      ) AS "activeIndex",
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'refresh_tokens'
          AND indexname = 'refresh_tokens_org_id_idx'
      ) AS "orgIndex",
      COALESCE((
        SELECT relrowsecurity FROM pg_class WHERE oid = 'public.refresh_tokens'::regclass
      ), FALSE) AS rls,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'refresh_tokens'
          AND policyname = 'backend_api_only_no_direct_client_access'
          AND permissive = 'RESTRICTIVE'
          AND roles @> ARRAY['anon', 'authenticated']::name[]
          AND qual = 'false' AND with_check = 'false'
      ) AS "browserDenyPolicy",
      EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.refresh_tokens'::regclass
          AND polname = 'backend_database_role_full_access'
          AND polpermissive = TRUE
          AND (SELECT oid FROM pg_roles WHERE rolname = current_user) = ANY(polroles)
          AND pg_get_expr(polqual, polrelid) = 'true'
          AND pg_get_expr(polwithcheck, polrelid) = 'true'
      ) AS "backendPolicy"
  `;

  if (!catalog || Object.values(catalog).some((value) => value !== true)) {
    throw new Error("browser-session catalog, indexes, constraints, or RLS boundary is invalid");
  }
}

async function createIdentity(fixture: Fixture) {
  const organization = await prisma.organization.create({
    data: { name: "Session runtime", slug: `session-runtime-${randomUUID()}` }
  });
  fixture.organizationId = organization.id;
  const email = `session-runtime-${randomUUID()}@example.com`;
  const password = "RuntimePassword123!";
  const user = await prisma.user.create({
    data: {
      orgId: organization.id,
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword(password, env.PASSWORD_HASH_COST),
      displayName: "Session Runtime",
      globalRole: "owner",
      workspaceRoleDefault: "manager"
    }
  });
  fixture.userId = user.id;
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    create: {
      organizationId: organization.id,
      userId: user.id,
      globalRole: "owner",
      workspaceRoleDefault: "manager",
      isActive: true
    },
    update: { globalRole: "owner", workspaceRoleDefault: "manager", isActive: true }
  });
  return { organization, user, email, password };
}

async function verifyRotationAndReplay(auth: AuthService, email: string, password: string) {
  const login = await auth.login({ email, password, sessionMode: "browser" });
  const access = tokenSessionId(login.accessToken);
  const refresh = tokenSessionId(login.refreshToken);
  if (access.typ !== "access" || refresh.typ !== "refresh" || access.sessionId !== refresh.sessionId) {
    throw new Error("browser token pair does not share one typed session family");
  }
  const original = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(login.refreshToken) } });
  if (!original || original.sessionId !== access.sessionId || original.clientType !== "browser" || original.parentTokenId) {
    throw new Error("browser login did not persist the authoritative session family");
  }

  const next = await auth.refresh(login.refreshToken, "browser");
  const nextAccess = tokenSessionId(next.accessToken);
  const [oldRow, nextRow] = await Promise.all([
    prisma.refreshToken.findUnique({ where: { id: original.id } }),
    prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(next.refreshToken) } })
  ]);
  if (
    !oldRow?.revokedAt || !oldRow.replacedAt || !nextRow || nextRow.parentTokenId !== original.id ||
    nextRow.sessionId !== original.sessionId || nextRow.clientType !== "browser" || nextAccess.sessionId !== original.sessionId
  ) {
    throw new Error("refresh rotation did not atomically persist parent, replacement, and family state");
  }
  await auth.assertSessionActive(nextAccess.sessionId, login.user.id, login.user.orgId);

  await expectCode(() => auth.refresh(login.refreshToken, "browser"), "refresh_reused");
  const family = await prisma.refreshToken.findMany({ where: { sessionId: original.sessionId } });
  if (family.length !== 2 || family.some((row) => !row.revokedAt || !row.reuseDetectedAt)) {
    throw new Error("refresh replay did not revoke and mark the entire token family");
  }
  await expectCode(
    () => auth.assertSessionActive(nextAccess.sessionId, login.user.id, login.user.orgId),
    "session_revoked"
  );
}

async function verifyConcurrentRotation(auth: AuthService, email: string, password: string) {
  const login = await auth.login({ email, password, sessionMode: "browser" });
  const sessionId = tokenSessionId(login.accessToken).sessionId;
  const attempts = await Promise.allSettled([
    auth.refresh(login.refreshToken, "browser"),
    auth.refresh(login.refreshToken, "browser")
  ]);
  if (attempts.filter((result) => result.status === "fulfilled").length !== 1) {
    throw new Error("concurrent refresh did not produce exactly one rotation winner");
  }
  const family = await prisma.refreshToken.findMany({ where: { sessionId } });
  if (family.length !== 2 || family.some((row) => !row.revokedAt)) {
    throw new Error("concurrent refresh reuse did not fence and revoke the family");
  }
}

async function verifyLogoutAndBearerCompatibility(auth: AuthService, email: string, password: string) {
  const browser = await auth.login({ email, password, sessionMode: "browser" });
  const browserSessionId = tokenSessionId(browser.accessToken).sessionId;
  await auth.logout(browser.refreshToken);
  const activeBrowserRows = await prisma.refreshToken.count({ where: { sessionId: browserSessionId, revokedAt: null } });
  if (activeBrowserRows !== 0) throw new Error("browser logout left an active family token");
  await expectCode(
    () => auth.assertSessionActive(browserSessionId, browser.user.id, browser.user.orgId),
    "session_revoked"
  );

  const bearer = await auth.login({ email, password });
  const bearerSessionId = tokenSessionId(bearer.accessToken).sessionId;
  const bearerRow = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(bearer.refreshToken) } });
  if (bearerRow?.clientType !== "bearer" || bearerRow.sessionId !== bearerSessionId) {
    throw new Error("bearer client compatibility session was not persisted");
  }
  const rotated = await auth.refresh(bearer.refreshToken, "bearer");
  await auth.assertSessionActive(tokenSessionId(rotated.accessToken).sessionId, bearer.user.id, bearer.user.orgId);
}

async function cleanup(fixture: Fixture) {
  if (fixture.userId) {
    await prisma.refreshToken.deleteMany({ where: { userId: fixture.userId } });
    await prisma.organizationMembership.deleteMany({ where: { userId: fixture.userId } });
    await prisma.user.deleteMany({ where: { id: fixture.userId } });
  }
  if (fixture.organizationId) {
    await prisma.organization.deleteMany({ where: { id: fixture.organizationId } });
  }
}

async function main() {
  const fixture: Fixture = {};
  try {
    await verifyCatalog();
    const identity = await createIdentity(fixture);
    const auth = new AuthService(prisma, env, { record: async () => undefined } as any);
    await verifyRotationAndReplay(auth, identity.email, identity.password);
    await verifyConcurrentRotation(auth, identity.email, identity.password);
    await verifyLogoutAndBearerCompatibility(auth, identity.email, identity.password);
    console.log("HttpOnly browser session runtime verification passed.");
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
