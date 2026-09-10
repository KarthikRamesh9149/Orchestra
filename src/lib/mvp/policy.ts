import type { CommunicationProvider, ProjectRole, WorkspaceRoleDefault } from "@prisma/client";

export type MvpPolicyEnv = {
  MVP_MODE?: boolean;
  MVP_EQUAL_PROJECT_ACCESS?: boolean;
  MVP_ENABLED_COMMUNICATION_PROVIDERS?: readonly CommunicationProvider[];
  MVP_ENABLE_ADVANCED_CONNECTORS?: boolean;
  MVP_ENABLE_CLIENT_PORTAL?: boolean;
  MVP_ENABLE_AUDIO_TRANSCRIPTION?: boolean;
  MVP_ENABLE_PROJECT_FINANCE?: boolean;
  MVP_ENABLE_PROJECT_SUBSCRIPTIONS?: boolean;
  MVP_ENABLE_CALENDAR_SYNC?: boolean;
  BETA_GOOGLE_CALENDAR_ENABLED?: boolean;
  BETA_GOOGLE_CALENDAR_OAUTH_ENABLED?: boolean;
  BETA_GOOGLE_CALENDAR_WEBHOOKS_ENABLED?: boolean;
  BETA_GOOGLE_CALENDAR_WRITE_ACTIONS_ENABLED?: boolean;
  BETA_ZOHO_MAIL_CONNECTOR_ENABLED?: boolean;
  BETA_ZOHO_CLIQ_CONNECTOR_ENABLED?: boolean;
  BETA_ZOHO_CRM_CONNECTOR_ENABLED?: boolean;
  BETA_NOTION_CONNECTOR_ENABLED?: boolean;
  BETA_MICROSOFT_TEAMS_CONNECTOR_ENABLED?: boolean;
  MVP_ENABLE_CALENDLY?: boolean;
  MVP_SIMPLE_CHANGE_APPLY?: boolean;
  MVP_REQUIRE_MANAGER_APPROVAL?: boolean;
  MVP_SHOW_VERSION_HISTORY?: boolean;
  MVP_ENABLE_IMAGE_CONTEXT?: boolean;
  MVP_ENABLE_IMAGE_VISION_SUMMARY?: boolean;
};

export type MvpMembershipLike =
  | ProjectRole
  | {
      projectRole?: ProjectRole | null;
      isActive?: boolean | null;
      workspaceRoleDefault?: WorkspaceRoleDefault | null;
    }
  | null
  | undefined;

const DEFAULT_MVP_PROVIDERS: CommunicationProvider[] = [
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
];

export function isMvpMode(env?: MvpPolicyEnv | null) {
  return env?.MVP_MODE === true;
}

export function isMvpEqualProjectAccessEnabled(env?: MvpPolicyEnv | null) {
  return isMvpMode(env) && env?.MVP_EQUAL_PROJECT_ACCESS === true;
}

export function getMvpEnabledCommunicationProviders(env?: MvpPolicyEnv | null): CommunicationProvider[] {
  return env?.MVP_ENABLED_COMMUNICATION_PROVIDERS != null
    ? [...env.MVP_ENABLED_COMMUNICATION_PROVIDERS]
    : DEFAULT_MVP_PROVIDERS;
}

export function canProjectMemberMutate(env: MvpPolicyEnv | null | undefined, membershipOrRole: MvpMembershipLike) {
  if (isMvpEqualProjectAccessEnabled(env) && typeof membershipOrRole === "string") {
    return false;
  }
  const membership = normalizeMembership(membershipOrRole);
  if (!membership.isActive || membership.workspaceRoleDefault === "client") {
    return false;
  }

  if (isMvpEqualProjectAccessEnabled(env)) {
    return membership.projectRole === "manager" || membership.projectRole === "dev";
  }

  return membership.projectRole === "manager";
}

export function canProjectMemberUseSocrates(env: MvpPolicyEnv | null | undefined, membershipOrRole: MvpMembershipLike) {
  if (isMvpEqualProjectAccessEnabled(env) && typeof membershipOrRole === "string") {
    return false;
  }
  const membership = normalizeMembership(membershipOrRole);
  if (!membership.isActive || membership.workspaceRoleDefault === "client") {
    return false;
  }
  if (isMvpEqualProjectAccessEnabled(env)) {
    return membership.projectRole === "manager" || membership.projectRole === "dev";
  }
  return membership.projectRole !== "client";
}

export function canProjectMemberUploadContext(env: MvpPolicyEnv | null | undefined, membershipOrRole: MvpMembershipLike) {
  return canProjectMemberMutate(env, membershipOrRole);
}

export function canProjectMemberManageTeamContext(
  env: MvpPolicyEnv | null | undefined,
  membershipOrRole: MvpMembershipLike
) {
  return canProjectMemberMutate(env, membershipOrRole);
}

export function isProviderEnabledForMvp(env: MvpPolicyEnv | null | undefined, provider: CommunicationProvider) {
  if (!isMvpMode(env)) {
    return true;
  }
  return getMvpEnabledCommunicationProviders(env).includes(provider);
}

export function shouldExposeAdvancedConnector(env: MvpPolicyEnv | null | undefined, provider: CommunicationProvider) {
  if (!isMvpMode(env)) {
    return true;
  }
  if (!isProviderEnabledForMvp(env, provider)) {
    return false;
  }
  return env?.MVP_ENABLE_ADVANCED_CONNECTORS !== false || DEFAULT_MVP_PROVIDERS.includes(provider);
}

export function shouldExposeClientPortal(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env) || env?.MVP_ENABLE_CLIENT_PORTAL !== false;
}

export function shouldExposeAudioTranscription(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env) || env?.MVP_ENABLE_AUDIO_TRANSCRIPTION === true;
}

export function shouldExposeFinance(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env) || env?.MVP_ENABLE_PROJECT_FINANCE !== false;
}

export function shouldExposeSubscriptions(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env) || env?.MVP_ENABLE_PROJECT_SUBSCRIPTIONS !== false;
}

export function shouldExposeCalendarSync(env: MvpPolicyEnv | null | undefined) {
  if (!isMvpMode(env)) return true;
  if (env?.BETA_GOOGLE_CALENDAR_ENABLED === false) return false;
  return env?.MVP_ENABLE_CALENDAR_SYNC !== false;
}

export function shouldExposeSimpleCalendar(_env: MvpPolicyEnv | null | undefined) {
  return true;
}

export function shouldExposeAdvancedProjectOps(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env);
}

export function shouldExposeCalendly(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env) || env?.MVP_ENABLE_CALENDLY === true;
}

export function shouldUseSimpleChangeApply(env: MvpPolicyEnv | null | undefined) {
  return isMvpMode(env) && env?.MVP_SIMPLE_CHANGE_APPLY === true;
}

export function shouldRequireManagerApproval(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env) || env?.MVP_REQUIRE_MANAGER_APPROVAL !== false;
}

export function shouldShowVersionHistory(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env) || env?.MVP_SHOW_VERSION_HISTORY !== false;
}

export function shouldEnableImageContext(env: MvpPolicyEnv | null | undefined) {
  return !isMvpMode(env) || env?.MVP_ENABLE_IMAGE_CONTEXT !== false;
}

export function shouldEnableImageVisionSummary(env: MvpPolicyEnv | null | undefined) {
  return isMvpMode(env) && env?.MVP_ENABLE_IMAGE_VISION_SUMMARY === true;
}

function normalizeMembership(membershipOrRole: MvpMembershipLike) {
  if (typeof membershipOrRole === "string") {
    return { projectRole: membershipOrRole, isActive: true, workspaceRoleDefault: null };
  }

  return {
    projectRole: membershipOrRole?.projectRole ?? null,
    isActive: membershipOrRole?.isActive ?? true,
    workspaceRoleDefault: membershipOrRole?.workspaceRoleDefault ?? null
  };
}
