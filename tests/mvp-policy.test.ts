import { describe, expect, it } from "vitest";
import {
  canProjectMemberManageTeamContext,
  canProjectMemberMutate,
  canProjectMemberUploadContext,
  canProjectMemberUseSocrates,
  getMvpEnabledCommunicationProviders,
  isMvpEqualProjectAccessEnabled,
  isMvpMode,
  isProviderEnabledForMvp,
  shouldExposeAdvancedConnector,
  shouldExposeAdvancedProjectOps,
  shouldExposeAudioTranscription,
  shouldExposeCalendarSync,
  shouldExposeCalendly,
  shouldExposeClientPortal,
  shouldExposeFinance,
  shouldExposeSimpleCalendar,
  shouldExposeSubscriptions,
  shouldEnableImageContext,
  shouldEnableImageVisionSummary,
  shouldRequireManagerApproval,
  shouldShowVersionHistory,
  shouldUseSimpleChangeApply
} from "../src/lib/mvp/policy.js";

const fullMode = {
  MVP_MODE: false,
  MVP_EQUAL_PROJECT_ACCESS: false,
  MVP_ENABLED_COMMUNICATION_PROVIDERS: [
    "manual_import",
    "fireflies_ai",
    "slack",
    "clickup",
    "granola",
    "microsoft_teams",
    "zoho_mail",
    "zoho_cliq",
    "zoho_crm",
    "notion"
  ]
} as const;

const mvpMode = {
  MVP_MODE: true,
  MVP_EQUAL_PROJECT_ACCESS: true,
  MVP_ENABLED_COMMUNICATION_PROVIDERS: [
    "manual_import",
    "fireflies_ai",
    "slack",
    "clickup",
    "granola",
    "microsoft_teams",
    "zoho_mail",
    "zoho_cliq",
    "zoho_crm",
    "notion"
  ],
  MVP_ENABLE_ADVANCED_CONNECTORS: false,
  MVP_ENABLE_CLIENT_PORTAL: false,
  MVP_ENABLE_AUDIO_TRANSCRIPTION: false,
  MVP_ENABLE_PROJECT_FINANCE: false,
  MVP_ENABLE_PROJECT_SUBSCRIPTIONS: false,
  MVP_ENABLE_CALENDAR_SYNC: false,
  MVP_ENABLE_CALENDLY: false,
  MVP_SIMPLE_CHANGE_APPLY: true,
  MVP_REQUIRE_MANAGER_APPROVAL: false,
  MVP_SHOW_VERSION_HISTORY: false,
  MVP_ENABLE_IMAGE_CONTEXT: true,
  MVP_ENABLE_IMAGE_VISION_SUMMARY: false
} as const;

describe("MVP policy", () => {
  it("preserves normal manager-only mutation semantics outside MVP mode", () => {
    expect(isMvpMode(fullMode)).toBe(false);
    expect(isMvpEqualProjectAccessEnabled(fullMode)).toBe(false);
    expect(canProjectMemberMutate(fullMode, { projectRole: "manager", isActive: true })).toBe(true);
    expect(canProjectMemberMutate(fullMode, { projectRole: "dev", isActive: true })).toBe(false);
    expect(canProjectMemberUploadContext(fullMode, { projectRole: "dev", isActive: true })).toBe(false);
    expect(canProjectMemberManageTeamContext(fullMode, { projectRole: "client", isActive: true })).toBe(false);
    expect(canProjectMemberUseSocrates(fullMode, { projectRole: "dev", isActive: true })).toBe(true);
  });

  it("treats active internal manager and dev project members equally in MVP mode", () => {
    for (const projectRole of ["manager", "dev"] as const) {
      const member = { projectRole, isActive: true };
      expect(canProjectMemberMutate(mvpMode, member)).toBe(true);
      expect(canProjectMemberUploadContext(mvpMode, member)).toBe(true);
      expect(canProjectMemberManageTeamContext(mvpMode, member)).toBe(true);
      expect(canProjectMemberUseSocrates(mvpMode, member)).toBe(true);
    }
  });

  it("does not elevate clients, inactive members, or client workspace users", () => {
    expect(canProjectMemberMutate(mvpMode, { projectRole: "client", isActive: true })).toBe(false);
    expect(canProjectMemberMutate(mvpMode, { projectRole: "dev", isActive: false })).toBe(false);
    expect(canProjectMemberMutate(mvpMode, {
      projectRole: "dev",
      isActive: true,
      workspaceRoleDefault: "client"
    })).toBe(false);
    expect(canProjectMemberMutate(mvpMode, "dev")).toBe(false);
    expect(canProjectMemberUseSocrates(mvpMode, "dev")).toBe(false);
  });

  it("gates communication providers for MVP mode", () => {
    expect(getMvpEnabledCommunicationProviders({ MVP_MODE: true } as const)).toEqual([
      "manual_import",
      "fireflies_ai",
      "slack",
      "clickup",
      "granola",
      "microsoft_teams",
      "zoho_mail",
      "zoho_cliq",
      "zoho_crm",
      "notion"
    ]);
    expect(getMvpEnabledCommunicationProviders(mvpMode)).toEqual([
      "manual_import",
      "fireflies_ai",
      "slack",
      "clickup",
      "granola",
      "microsoft_teams",
      "zoho_mail",
      "zoho_cliq",
      "zoho_crm",
      "notion"
    ]);
    expect(getMvpEnabledCommunicationProviders({ ...mvpMode, MVP_ENABLED_COMMUNICATION_PROVIDERS: [] })).toEqual([]);
    expect(isProviderEnabledForMvp(mvpMode, "manual_import")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "fireflies_ai")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "slack")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "clickup")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "zoho_mail")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "zoho_cliq")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "zoho_crm")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "notion")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "granola")).toBe(true);
    expect(isProviderEnabledForMvp(mvpMode, "microsoft_teams")).toBe(true);
    expect(shouldExposeAdvancedConnector(mvpMode, "gmail")).toBe(false);
    expect(shouldExposeAdvancedConnector(mvpMode, "outlook")).toBe(false);
    expect(shouldExposeAdvancedConnector(mvpMode, "whatsapp_business")).toBe(false);
    expect(shouldExposeAdvancedConnector(mvpMode, "slack")).toBe(true);
    expect(shouldExposeAdvancedConnector(mvpMode, "clickup")).toBe(true);
    expect(shouldExposeAdvancedConnector(mvpMode, "granola")).toBe(true);
    expect(shouldExposeAdvancedConnector(mvpMode, "microsoft_teams")).toBe(true);
    expect(shouldExposeAdvancedConnector(fullMode, "gmail")).toBe(true);
  });

  it("exposes advanced features from MVP flags only when enabled", () => {
    expect(shouldExposeClientPortal(mvpMode)).toBe(false);
    expect(shouldExposeAudioTranscription(mvpMode)).toBe(false);
    expect(shouldExposeFinance(mvpMode)).toBe(false);
    expect(shouldExposeSubscriptions(mvpMode)).toBe(false);
    expect(shouldExposeCalendarSync(mvpMode)).toBe(false);
    expect(shouldExposeSimpleCalendar(mvpMode)).toBe(true);
    expect(shouldExposeAdvancedProjectOps(mvpMode)).toBe(false);
    expect(shouldExposeAdvancedProjectOps(fullMode)).toBe(true);
    expect(shouldExposeCalendly(mvpMode)).toBe(false);
    expect(shouldUseSimpleChangeApply(mvpMode)).toBe(true);
    expect(shouldRequireManagerApproval(mvpMode)).toBe(false);
    expect(shouldShowVersionHistory(mvpMode)).toBe(false);
    expect(shouldEnableImageContext(mvpMode)).toBe(true);
    expect(shouldEnableImageVisionSummary(mvpMode)).toBe(false);
    expect(shouldEnableImageContext({ ...mvpMode, MVP_ENABLE_IMAGE_CONTEXT: false })).toBe(false);
    expect(shouldEnableImageVisionSummary({ ...mvpMode, MVP_ENABLE_IMAGE_VISION_SUMMARY: true })).toBe(true);
  });
});
