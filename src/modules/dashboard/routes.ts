import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard, requireManager } from "../../app/auth.js";
import { isMvpEqualProjectAccessEnabled } from "../../lib/mvp/policy.js";
import {
  activityQuerySchema,
  calendarEventsQuerySchema,
  createCalendarEventSchema,
  dashboardContextSnapshotSchema,
  dashboardFileParamsSchema,
  generalDashboardQuerySchema,
  missionControlQuerySchema,
  projectDashboardQuerySchema,
  projectParamsSchema,
  recentListQuerySchema
} from "./schemas.js";

export const registerDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/mission-control",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = missionControlQuerySchema.parse(request.query);
      const result = await request.appContext.services.dashboardService.getMissionControl(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/mission-control",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = missionControlQuerySchema.parse(request.query);
      const result = await request.appContext.services.dashboardService.getMissionControl(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/activity",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = activityQuerySchema.parse(request.query);
      const result = await request.appContext.services.dashboardService.getActivityFeed(
        params.projectId,
        request.authUser!.userId,
        query.limit
      );
      return { data: { items: result }, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/recent-changes",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = recentListQuerySchema.parse(request.query);
      const result = await request.appContext.services.dashboardService.getRecentChanges(
        params.projectId,
        request.authUser!.userId,
        query.limit
      );
      return { data: { items: result }, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/socrates/recent-queries",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = recentListQuerySchema.parse(request.query);
      const result = await request.appContext.services.dashboardService.getRecentSocratesQueries(
        params.projectId,
        request.authUser!.userId,
        query.limit
      );
      return { data: { items: result }, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/calendar-events",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = calendarEventsQuerySchema.parse(request.query);
      const result = await request.appContext.services.dashboardService.getCalendarEvents(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: { items: result }, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/calendar-events",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const body = createCalendarEventSchema.parse(request.body);
      const result = await request.appContext.services.dashboardService.createCalendarEvent(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github/preview",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getGithubPreview(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/dashboard/general",
    authGuard(async (request) => {
      requireManager(request);
      const query = generalDashboardQuerySchema.parse(request.query);
      const result = await request.appContext.services.dashboardService.getGeneralDashboard({
        orgId: request.authUser!.orgId,
        actorUserId: request.authUser!.userId,
        forceRefresh: query.forceRefresh
      });
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = projectDashboardQuerySchema.parse(request.query);
      if (query.forceRefresh && !isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const result = await request.appContext.services.dashboardService.getProjectDashboard(
        params.projectId,
        request.authUser!.userId,
        { forceRefresh: query.forceRefresh }
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/readiness",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getProjectDashboardSection(
        params.projectId,
        request.authUser!.userId,
        "readinessSummary"
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/mock-real",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getProjectDashboardSection(
        params.projectId,
        request.authUser!.userId,
        "mockVsRealRegistry"
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/seams",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getProjectDashboardSection(
        params.projectId,
        request.authUser!.userId,
        "integrationSeams"
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/conflicts",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getProjectDashboardSection(
        params.projectId,
        request.authUser!.userId,
        "conflictRadar"
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/files/:filePath/safe-to-touch",
    authGuard(async (request) => {
      const params = dashboardFileParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getSafeToTouchForFile(
        params.projectId,
        request.authUser!.userId,
        decodeURIComponent(params.filePath)
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/dashboard/context-snapshot",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const body = dashboardContextSnapshotSchema.parse(request.body);
      const result = await request.appContext.services.dashboardService.createContextSnapshot(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/rationale-trace",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getProjectDashboardSection(
        params.projectId,
        request.authUser!.userId,
        "rationaleTraces"
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/branch-deploy-truth",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getProjectDashboardSection(
        params.projectId,
        request.authUser!.userId,
        "branchDeployTruth"
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/dashboard/agent-activity",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getProjectDashboardSection(
        params.projectId,
        request.authUser!.userId,
        "agentActivity"
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/team-summary",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.getProjectTeamSummary(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/dashboard/refresh",
    authGuard(async (request) => {
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.dashboardService.refreshProjectDashboard(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};
