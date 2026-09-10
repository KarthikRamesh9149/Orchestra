import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard, requireManager } from "../../app/auth.js";
import { AppError } from "../../app/errors.js";
import { withRateLimit } from "../../app/security.js";
import { isMvpBetaMode } from "../../lib/beta/policy.js";
import {
  shouldExposeAdvancedProjectOps,
  shouldExposeCalendarSync,
  shouldExposeFinance,
  shouldExposeSubscriptions
} from "../../lib/mvp/policy.js";
import {
  calendarQuerySchema,
  calendarOAuthCallbackSchema,
  calendarProviderParamsSchema,
  connectionParamsSchema,
  costEntryListQuerySchema,
  costEntryParamsSchema,
  createCostEntrySchema,
  createDeadlineSchema,
  createMeetingSchema,
  createSeriesSchema,
  createSubscriptionSchema,
  deadlineParamsSchema,
  financialBreakdownQuerySchema,
  googleCalendarSelectionSchema,
  meetingParamsSchema,
  projectOpsListQuerySchema,
  projectParamsSchema,
  renewalsQuerySchema,
  seriesParamsSchema,
  subscriptionParamsSchema,
  syncRunsQuerySchema,
  updateCostEntrySchema,
  updateDeadlineSchema,
  updateFinancialSummarySchema,
  updateMeetingSchema,
  updateSeriesSchema,
  updateSubscriptionSchema
} from "./schemas.js";

export const registerProjectOpsRoutes: FastifyPluginAsync = async (app) => {
  const webhookRateLimit = (options = {}) => withRateLimit(options, app.appContext.env, "webhook");
  const assertFinanceEnabled = () => {
    if (!shouldExposeFinance(app.appContext.env)) {
      throw new AppError(403, "Project finance is disabled in MVP mode", "feature_disabled");
    }
  };
  const assertSubscriptionsEnabled = () => {
    if (isMvpBetaMode(app.appContext.env) && app.appContext.env.BETA_PROJECT_SUBSCRIPTIONS_ENABLED) {
      return;
    }
    if (!shouldExposeSubscriptions(app.appContext.env)) {
      throw new AppError(403, "Project subscriptions are disabled in MVP mode", "feature_disabled");
    }
  };
  const assertCalendarSyncEnabled = () => {
    if (!shouldExposeCalendarSync(app.appContext.env)) {
      throw new AppError(403, "External calendar sync is disabled in MVP mode", "feature_disabled");
    }
  };
  const assertAdvancedProjectOpsEnabled = () => {
    if (!shouldExposeAdvancedProjectOps(app.appContext.env)) {
      throw new AppError(403, "Advanced project operations are disabled in MVP mode", "feature_disabled");
    }
  };

  app.get(
    "/calendar",
    authGuard(async (request) => {
      const query = calendarQuerySchema.parse(request.query);
      if (!query.projectId) {
        requireManager(request);
      }
      const data = await request.appContext.services.projectOpsService.getCalendar({
        actorUserId: request.authUser!.userId,
        orgId: request.authUser!.orgId,
        projectId: query.projectId,
        from: query.from,
        to: query.to,
        month: query.month
      });
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/meetings",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = projectOpsListQuerySchema.parse(request.query);
      const data = await request.appContext.services.projectOpsService.listMeetings(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/meetings",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const body = createMeetingSchema.parse(request.body);
      const data = await request.appContext.services.projectOpsService.createMeeting(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/meetings/:meetingId",
    authGuard(async (request) => {
      const params = meetingParamsSchema.parse(request.params);
      const data = await request.appContext.services.projectOpsService.getMeeting(
        params.projectId,
        params.meetingId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/meetings/:meetingId",
    authGuard(async (request) => {
      const params = meetingParamsSchema.parse(request.params);
      const body = updateMeetingSchema.parse(request.body);
      const data = await request.appContext.services.projectOpsService.updateMeeting(
        params.projectId,
        params.meetingId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/meetings/:meetingId",
    authGuard(async (request) => {
      const params = meetingParamsSchema.parse(request.params);
      const data = await request.appContext.services.projectOpsService.deleteMeeting(
        params.projectId,
        params.meetingId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/deadlines",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = projectOpsListQuerySchema.parse(request.query);
      const data = await request.appContext.services.projectOpsService.listDeadlines(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/deadlines",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const body = createDeadlineSchema.parse(request.body);
      const data = await request.appContext.services.projectOpsService.createDeadline(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/deadlines/:deadlineId",
    authGuard(async (request) => {
      const params = deadlineParamsSchema.parse(request.params);
      const data = await request.appContext.services.projectOpsService.getDeadline(
        params.projectId,
        params.deadlineId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/deadlines/:deadlineId",
    authGuard(async (request) => {
      const params = deadlineParamsSchema.parse(request.params);
      const body = updateDeadlineSchema.parse(request.body);
      const data = await request.appContext.services.projectOpsService.updateDeadline(
        params.projectId,
        params.deadlineId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/deadlines/:deadlineId",
    authGuard(async (request) => {
      const params = deadlineParamsSchema.parse(request.params);
      const data = await request.appContext.services.projectOpsService.deleteDeadline(
        params.projectId,
        params.deadlineId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/financials",
    authGuard(async (request) => {
      assertFinanceEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.projectOpsService.getFinancialSummary(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.put(
    "/projects/:projectId/financials",
    authGuard(async (request) => {
      assertFinanceEnabled();
      const params = projectParamsSchema.parse(request.params);
      const body = updateFinancialSummarySchema.parse(request.body);
      const data = await request.appContext.services.projectOpsService.updateFinancialSummary(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/subscriptions",
    authGuard(async (request) => {
      assertSubscriptionsEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.projectOpsService.listSubscriptions(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/subscriptions",
    authGuard(async (request) => {
      assertSubscriptionsEnabled();
      const params = projectParamsSchema.parse(request.params);
      const body = createSubscriptionSchema.parse(request.body);
      const data = await request.appContext.services.projectOpsService.createSubscription(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  // NOTE: /subscriptions/renewals must be registered BEFORE /subscriptions/:subscriptionId
  // so Fastify doesn't route "renewals" as a subscriptionId parameter.
  app.get(
    "/projects/:projectId/subscriptions/renewals",
    authGuard(async (request) => {
      assertSubscriptionsEnabled();
      const params = projectParamsSchema.parse(request.params);
      const query = renewalsQuerySchema.parse(request.query);
      const data = await request.appContext.services.rollupsService.getRenewals(
        params.projectId,
        request.authUser!.userId,
        query.windowDays
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/subscriptions/:subscriptionId",
    authGuard(async (request) => {
      assertSubscriptionsEnabled();
      const params = subscriptionParamsSchema.parse(request.params);
      const data = await request.appContext.services.projectOpsService.getSubscription(
        params.projectId,
        params.subscriptionId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/subscriptions/:subscriptionId",
    authGuard(async (request) => {
      assertSubscriptionsEnabled();
      const params = subscriptionParamsSchema.parse(request.params);
      const body = updateSubscriptionSchema.parse(request.body);
      const data = await request.appContext.services.projectOpsService.updateSubscription(
        params.projectId,
        params.subscriptionId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/subscriptions/:subscriptionId",
    authGuard(async (request) => {
      assertSubscriptionsEnabled();
      const params = subscriptionParamsSchema.parse(request.params);
      const data = await request.appContext.services.projectOpsService.deleteSubscription(
        params.projectId,
        params.subscriptionId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  // ── Feature 8: Event Series ────────────────────────────────────────────────

  app.get(
    "/projects/:projectId/meeting-series",
    authGuard(async (request) => {
      assertAdvancedProjectOpsEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.recurringService.listSeries(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/meeting-series",
    authGuard(async (request) => {
      assertAdvancedProjectOpsEnabled();
      const params = projectParamsSchema.parse(request.params);
      const body = createSeriesSchema.parse(request.body);
      const data = await request.appContext.services.recurringService.createSeries(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/meeting-series/:seriesId",
    authGuard(async (request) => {
      assertAdvancedProjectOpsEnabled();
      const params = seriesParamsSchema.parse(request.params);
      const data = await request.appContext.services.recurringService.getSeries(
        params.projectId,
        params.seriesId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/meeting-series/:seriesId",
    authGuard(async (request) => {
      assertAdvancedProjectOpsEnabled();
      const params = seriesParamsSchema.parse(request.params);
      const body = updateSeriesSchema.parse(request.body);
      const data = await request.appContext.services.recurringService.updateSeries(
        params.projectId,
        params.seriesId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/meeting-series/:seriesId",
    authGuard(async (request) => {
      assertAdvancedProjectOpsEnabled();
      const params = seriesParamsSchema.parse(request.params);
      const data = await request.appContext.services.recurringService.deleteSeries(
        params.projectId,
        params.seriesId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  // ── Feature 8: Calendar Connections ───────────────────────────────────────

  app.get(
    "/projects/:projectId/calendar-connections",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.listConnections(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/calendar-connections/:connectionId",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = connectionParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.getConnection(
        params.projectId,
        params.connectionId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/calendar-connections/:provider/connect",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = calendarProviderParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.initiateConnect(
        params.projectId,
        request.authUser!.userId,
        params.provider
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/calendar-connections/:connectionId/sync",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = connectionParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.triggerSync(
        params.projectId,
        params.connectionId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/calendar-connections/:connectionId/revoke",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = connectionParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.revokeConnection(
        params.projectId,
        params.connectionId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/calendar-connections/:connectionId/sync-runs",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = connectionParamsSchema.parse(request.params);
      const query = syncRunsQuerySchema.parse(request.query);
      const data = await request.appContext.services.calendarConnectionsService.listSyncRuns(
        params.projectId,
        params.connectionId,
        request.authUser!.userId,
        query.limit
      );
      return { data, meta: null, error: null };
    })
  );

  // Unified private-pilot Google Calendar connector routes.
  app.post(
    "/projects/:projectId/connectors/google-calendar/connect",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      if (request.appContext.env.BETA_GOOGLE_CALENDAR_OAUTH_ENABLED === false) {
        throw new AppError(403, "Google Calendar OAuth is disabled", "feature_disabled");
      }
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.initiateConnect(
        params.projectId,
        request.authUser!.userId,
        "google_calendar"
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/google-calendar/status",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.getGoogleCalendarStatus(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/google-calendar/calendars",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.listGoogleCalendars(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/connectors/google-calendar/calendars",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = projectParamsSchema.parse(request.params);
      const body = googleCalendarSelectionSchema.parse(request.body);
      const data = await request.appContext.services.calendarConnectionsService.updateSelectedGoogleCalendars(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/connectors/google-calendar/sync",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.triggerGoogleCalendarSync(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/connectors/google-calendar/disconnect",
    authGuard(async (request) => {
      assertCalendarSyncEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.calendarConnectionsService.disconnectGoogleCalendar(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/webhooks/google/calendar",
    webhookRateLimit(),
    async (request) => {
      assertCalendarSyncEnabled();
      const data = await request.appContext.services.calendarConnectionsService.handleGoogleCalendarWebhook(
        request.headers
      );
      return { data, meta: null, error: null };
    }
  );

  // OAuth callbacks — no authGuard; state param carries signed session
  app.get(
    "/oauth/google-calendar/callback",
    async (request, reply) => {
      assertCalendarSyncEnabled();
      const { code, state, error } = calendarOAuthCallbackSchema.parse(request.query);
      const frontendBaseUrl = request.appContext.env.FRONTEND_BASE_URL ?? request.appContext.env.APP_BASE_URL;
      if (error) {
        return reply.redirect(
          `${frontendBaseUrl}/connectors?calendar_error=${encodeURIComponent(error)}`
        );
      }
      if (!code || !state) throw new AppError(400, "OAuth code and state are required", "calendar_oauth_callback_invalid");
      const result = await request.appContext.services.calendarConnectionsService.handleOAuthCallback(
        "google_calendar",
        code,
        state
      );
      return reply.redirect(
        `${frontendBaseUrl}/connectors?calendar=connected&projectId=${encodeURIComponent(result.projectId)}`
      );
    }
  );

  app.get(
    "/oauth/google/calendar/callback",
    async (request, reply) => {
      assertCalendarSyncEnabled();
      const { code, state, error } = calendarOAuthCallbackSchema.parse(request.query);
      const frontendBaseUrl = request.appContext.env.FRONTEND_BASE_URL ?? request.appContext.env.APP_BASE_URL;
      if (error) {
        return reply.redirect(
          `${frontendBaseUrl}/connectors?calendar_error=${encodeURIComponent(error)}`
        );
      }
      if (!code || !state) throw new AppError(400, "OAuth code and state are required", "calendar_oauth_callback_invalid");
      const result = await request.appContext.services.calendarConnectionsService.handleOAuthCallback(
        "google_calendar",
        code,
        state
      );
      return reply.redirect(
        `${frontendBaseUrl}/connectors?calendar=connected&projectId=${encodeURIComponent(result.projectId)}`
      );
    }
  );

  app.get(
    "/oauth/outlook-calendar/callback",
    async (request, reply) => {
      assertCalendarSyncEnabled();
      const { code, state, error } = calendarOAuthCallbackSchema.parse(request.query);
      if (error) {
        return reply.redirect(
          `${request.appContext.env.APP_BASE_URL}/settings/integrations?error=${encodeURIComponent(error)}`
        );
      }
      if (!code || !state) throw new AppError(400, "OAuth code and state are required", "calendar_oauth_callback_invalid");
      const result = await request.appContext.services.calendarConnectionsService.handleOAuthCallback(
        "outlook_calendar",
        code,
        state
      );
      return reply.redirect(
        `${request.appContext.env.APP_BASE_URL}/projects/${result.projectId}/settings/calendar?connected=1`
      );
    }
  );

  // ── Feature 8: Cost Entries ────────────────────────────────────────────────

  app.get(
    "/projects/:projectId/cost-entries",
    authGuard(async (request) => {
      assertFinanceEnabled();
      const params = projectParamsSchema.parse(request.params);
      const query = costEntryListQuerySchema.parse(request.query);
      const data = await request.appContext.services.costEntriesService.listEntries(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/cost-entries",
    authGuard(async (request) => {
      assertFinanceEnabled();
      const params = projectParamsSchema.parse(request.params);
      const body = createCostEntrySchema.parse(request.body);
      const data = await request.appContext.services.costEntriesService.createEntry(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/cost-entries/:entryId",
    authGuard(async (request) => {
      assertFinanceEnabled();
      const params = costEntryParamsSchema.parse(request.params);
      const data = await request.appContext.services.costEntriesService.getEntry(
        params.projectId,
        params.entryId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/cost-entries/:entryId",
    authGuard(async (request) => {
      assertFinanceEnabled();
      const params = costEntryParamsSchema.parse(request.params);
      const body = updateCostEntrySchema.parse(request.body);
      const data = await request.appContext.services.costEntriesService.updateEntry(
        params.projectId,
        params.entryId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/cost-entries/:entryId",
    authGuard(async (request) => {
      assertFinanceEnabled();
      const params = costEntryParamsSchema.parse(request.params);
      const data = await request.appContext.services.costEntriesService.deleteEntry(
        params.projectId,
        params.entryId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  // ── Feature 8: Financial Breakdown, Renewals, Ops Summary ─────────────────

  app.get(
    "/projects/:projectId/financials/breakdown",
    authGuard(async (request) => {
      assertFinanceEnabled();
      const params = projectParamsSchema.parse(request.params);
      const query = financialBreakdownQuerySchema.parse(request.query);
      const data = await request.appContext.services.rollupsService.getFinancialBreakdown(
        params.projectId,
        request.authUser!.userId,
        query.groupBy
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/ops-summary",
    authGuard(async (request) => {
      assertFinanceEnabled();
      assertSubscriptionsEnabled();
      assertAdvancedProjectOpsEnabled();
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.rollupsService.getOpsSummary(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );
};
