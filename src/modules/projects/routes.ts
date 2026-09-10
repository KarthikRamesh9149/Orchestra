import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { internalAuthGuard as authGuard, requireManager } from "../../app/auth.js";
import { isMvpEqualProjectAccessEnabled } from "../../lib/mvp/policy.js";

const createProjectSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  previewUrl: z.string().url().optional().nullable()
});

const updateProjectSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    slug: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(2000).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one workspace setting must be provided"
  });

const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

const auditEventsQuerySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  eventType: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const memberParamsSchema = projectParamsSchema.extend({
  memberId: z.string().uuid()
});

const joinCodeParamsSchema = projectParamsSchema.extend({
  codeId: z.string().uuid()
});

const truthApproverBodySchema = z.object({
  memberId: z.string().uuid()
});

const projectRoleSchema = z.enum(["manager", "dev", "client"]);

const createJoinCodeBodySchema = z
  .object({
    projectRole: projectRoleSchema.optional().default("dev"),
    invitedEmail: z.string().trim().toLowerCase().email(),
    canApproveTruthChanges: z.boolean().optional().default(false),
    maxUses: z.coerce.number().int().min(1).max(1).optional().default(1),
    expiresAt: z.string().datetime().optional()
  })
  .superRefine((value, context) => {
    if (value.projectRole === "client" && value.canApproveTruthChanges) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canApproveTruthChanges"],
        message: "Client invitees cannot approve truth changes"
      });
    }
  });

const addProjectMemberSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  projectRole: projectRoleSchema,
  roleInProject: z.string().trim().min(1).max(120).optional().nullable(),
  allocationPercent: z.number().int().min(0).max(100).optional().nullable(),
  weeklyCapacityHours: z.number().int().min(0).max(168).optional().nullable()
});

const updateProjectMemberSchema = z
  .object({
    projectRole: projectRoleSchema.optional(),
    roleInProject: z.string().trim().min(1).max(120).optional().nullable(),
    allocationPercent: z.number().int().min(0).max(100).optional().nullable(),
    weeklyCapacityHours: z.number().int().min(0).max(168).optional().nullable(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one member field must be provided"
  });

export const registerProjectRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects",
    authGuard(async (request) => {
      requireManager(request);
      const body = createProjectSchema.parse(request.body);
      const project = await request.appContext.services.projectService.createProject({
        orgId: request.authUser!.orgId,
        actorUserId: request.authUser!.userId,
        ...body
      });

      return { data: project, meta: null, error: null };
    })
  );

  app.get(
    "/projects",
    authGuard(async (request) => {
      const projects = await request.appContext.services.projectService.listProjects(
        request.authUser!.userId,
        request.authUser!.orgId
      );
      return { data: projects, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const project = await request.appContext.services.projectService.getProject(
        params.projectId,
        request.authUser!.userId
      );
      return { data: project, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/settings",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const settings = await request.appContext.services.projectService.getProjectSettings(
        params.projectId,
        request.authUser!.userId
      );
      return { data: settings, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/settings/bundle",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const bundle = await request.appContext.services.projectService.getProjectSettingsBundle(
        params.projectId,
        request.authUser!.userId
      );
      return { data: bundle, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/settings",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const body = updateProjectSettingsSchema.parse(request.body ?? {});
      const settings = await request.appContext.services.projectService.updateProjectSettings(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: settings, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/members",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectService.getMembers(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/join-codes",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const body = createJoinCodeBodySchema.parse(request.body ?? {});
      const result = await request.appContext.services.projectService.createJoinCode(
        params.projectId,
        request.authUser!.userId,
        {
          projectRole: body.projectRole,
          invitedEmail: body.invitedEmail ?? undefined,
          canApproveTruthChanges: body.canApproveTruthChanges,
          maxUses: body.maxUses,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined
        }
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/join-codes",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectService.listJoinCodes(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/join-codes/:codeId/revoke",
    authGuard(async (request) => {
      const params = joinCodeParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectService.revokeJoinCode(
        params.projectId,
        params.codeId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/truth-approvers",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectService.listTruthApprovers(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/audit-events",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      await request.appContext.services.projectService.ensureProjectMemberCanViewProjectAudit(
        params.projectId,
        request.authUser!.userId
      );
      const query = auditEventsQuerySchema.parse(request.query);
      const result = await request.appContext.services.auditService.listProjectEvents({
        orgId: request.authUser!.orgId,
        projectId: params.projectId,
        actorUserId: query.actorUserId,
        eventType: query.eventType,
        entityType: query.entityType,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        cursor: query.cursor ? new Date(query.cursor) : undefined,
        limit: query.limit
      });

      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.post(
    "/projects/:projectId/members",
    authGuard(async (request) => {
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const params = projectParamsSchema.parse(request.params);
      const body = addProjectMemberSchema.parse(request.body);
      const result = await request.appContext.services.projectService.addMember(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/truth-approvers",
    authGuard(async (request) => {
      requireManager(request);
      const params = projectParamsSchema.parse(request.params);
      const body = truthApproverBodySchema.parse(request.body);
      const result = await request.appContext.services.projectService.grantTruthApprover(
        params.projectId,
        request.authUser!.userId,
        body.memberId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/truth-approvers/:memberId",
    authGuard(async (request) => {
      requireManager(request);
      const params = memberParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectService.revokeTruthApprover(
        params.projectId,
        request.authUser!.userId,
        params.memberId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/members/:memberId",
    authGuard(async (request) => {
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const params = memberParamsSchema.parse(request.params);
      const body = updateProjectMemberSchema.parse(request.body);
      const result = await request.appContext.services.projectService.updateMember(
        params.projectId,
        params.memberId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );
};
