import type {
  ActivityItem,
  CalendarEvent,
  DashboardStat,
  GitCommit,
  RecentChange,
  SlackMessage,
  SocratesQuery,
  Subscription,
  SubscriptionInput,
  TeamMember,
} from "../types/dashboard";
import { apiJson } from "./client";
export { loadOperationalState } from "./operationalState";
export type { OperationalState } from "./operationalState";

export interface DashboardData {
  stats: DashboardStat[];
  team: TeamMember[];
  changes: RecentChange[];
  calendarEvents: CalendarEvent[];
  slackMessages: SlackMessage[];
  gitCommits: GitCommit[];
  activity: ActivityItem[];
  socratesQueries: SocratesQuery[];
  subscriptions: Subscription[];
  updatedAt: string | null;
}

export type DashboardOptions = { forceRefresh?: boolean };

const STAT_ROUTES: Record<string, string> = {
  "open-prs": "/timeline?source=github",
  "commits-this-week": "/timeline?source=github",
  "slack-today": "/timeline?source=slack",
  "drive-files": "/memory",
  "active-now": "/settings#workspace",
};

export function dashboardStatRoute(id: string, source?: string) {
  if (STAT_ROUTES[id]) return STAT_ROUTES[id];
  if (source === "github") return "/timeline?source=github";
  if (source === "slack") return "/timeline?source=slack";
  if (source === "team") return "/settings#workspace";
  return "/dashboard";
}

function activityRoute(source: ActivityItem["source"]) {
  if (source === "socrates") return "/chat";
  if (source === "github") return "/memory?panel=timeline&source=github";
  if (["slack", "microsoft_teams", "zoho_mail", "zoho_cliq", "zoho_crm"].includes(source)) {
    return "/memory?panel=timeline&source=slack";
  }
  if (["document", "google_drive", "notion"].includes(source)) return "/memory";
  if (source === "vscode") return "/settings#integrations";
  return "/memory?panel=timeline";
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
}

function colorForSeed(seed: string) {
  const colors = ["#7C6FD9", "#2A9D8F", "#E5A663", "#C84A1F", "#4C78A8"];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function toneToColor(tone?: string) {
  if (tone === "teal") return { iconColor: "#2A9D8F", iconBg: "rgba(42,157,143,0.08)" };
  if (tone === "violet") return { iconColor: "#7C6FD9", iconBg: "rgba(124,111,217,0.08)" };
  if (tone === "neutral") return { iconColor: "#8A8378", iconBg: "rgba(138,131,120,0.08)" };
  return { iconColor: "#C84A1F", iconBg: "rgba(200,74,31,0.08)" };
}

function mapSubscription(value: any): Subscription {
  const tone = toneToColor("neutral");
  const name = String(value.name ?? "Unnamed subscription");
  return {
    id: String(value.id),
    name,
    category: String(value.category ?? "other").toUpperCase(),
    cost: Number(value.cost ?? 0),
    billingType: value.billingType ?? "monthly",
    status: value.status ?? "active",
    provider: value.provider ?? null,
    externalRef: value.externalRef ?? null,
    renewsAt: value.renewsAt ?? null,
    iconLabel: name.charAt(0).toUpperCase() || "?",
    iconBg: tone.iconBg,
    iconTextColor: tone.iconColor,
  };
}

export async function listSubscriptions(projectId: string) {
  const result = await apiJson<any[]>(`/v1/projects/${projectId}/subscriptions`);
  return result.map(mapSubscription);
}

export async function createSubscription(projectId: string, input: SubscriptionInput) {
  const result = await apiJson<any>(`/v1/projects/${projectId}/subscriptions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return mapSubscription(result);
}

export async function updateSubscription(projectId: string, subscriptionId: string, input: SubscriptionInput) {
  const result = await apiJson<any>(`/v1/projects/${projectId}/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return mapSubscription(result);
}

export async function deleteSubscription(projectId: string, subscriptionId: string) {
  await apiJson<{ ok: boolean }>(`/v1/projects/${projectId}/subscriptions/${subscriptionId}`, { method: "DELETE" });
}

export async function getDashboard(projectId: string, options: DashboardOptions = {}): Promise<DashboardData> {
  const query = new URLSearchParams({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (options.forceRefresh) query.set("forceRefresh", "true");
  const [mc, subscriptions] = await Promise.all([
    apiJson<any>(`/v1/projects/${projectId}/mission-control?${query.toString()}`),
    listSubscriptions(projectId),
  ]);

  return {
    stats: (mc.stats ?? []).map((stat: any): DashboardStat => ({
      id: String(stat.id),
      label: String(stat.label ?? ""),
      value: String(stat.value ?? ""),
      trend: Array.isArray(stat.trend) ? stat.trend.filter(Number.isFinite) : [],
      route: dashboardStatRoute(String(stat.id), stat.source),
      ...toneToColor(stat.tone),
    })),
    team: (mc.team ?? []).filter((member: any) => member.isActive !== false).map((member: any): TeamMember => ({
      id: String(member.id),
      name: String(member.name ?? "Unknown member"),
      initials: member.initials ?? initialsFor(String(member.name ?? "")),
      color: colorForSeed(String(member.name ?? member.id)),
      role: member.role,
    })),
    changes: (mc.recentChanges ?? []).map((change: any): RecentChange => ({
      id: String(change.id),
      title: String(change.title ?? "Untitled change"),
      status: ["accepted", "pending", "rejected", "needs_review"].includes(change.status) ? change.status : "pending",
      timeAgo: String(change.timeAgo ?? ""),
    })),
    calendarEvents: (mc.calendarEvents ?? []).map((event: any): CalendarEvent => ({
      id: String(event.id),
      title: String(event.title ?? "Untitled event"),
      day: String(event.day ?? ""),
      time: String(event.time ?? ""),
      startsAt: String(event.startsAt),
      endsAt: event.endsAt ?? null,
    })),
    slackMessages: (mc.slackMessages ?? []).map((message: any): SlackMessage => ({
      id: String(message.id),
      threadId: String(message.threadId),
      channelName: message.channelName ?? null,
      accountLabel: message.accountLabel ?? null,
      authorName: String(message.authorName ?? "Unknown"),
      initials: initialsFor(String(message.authorName ?? "")),
      avatarColor: colorForSeed(String(message.authorName ?? message.id)),
      timeAgo: String(message.timeAgo ?? ""),
      preview: String(message.preview ?? ""),
    })),
    gitCommits: (mc.gitCommits ?? []).map((commit: any): GitCommit => ({
      hash: String(commit.hash ?? commit.id),
      message: String(commit.message ?? ""),
      author: String(commit.author ?? "Unknown"),
      timeAgo: String(commit.timeAgo ?? ""),
      repository: commit.repository ?? mc.githubPreview?.repositoryLabel ?? null,
      branch: commit.branch ?? null,
    })),
    activity: (mc.activity ?? [])
      .filter((item: any) => item.source !== "system")
      .map((item: any): ActivityItem => ({
        id: String(item.id),
        source: item.source,
        text: String(item.text ?? ""),
        timeAgo: String(item.timeAgo ?? ""),
        route: activityRoute(item.source),
      })),
    socratesQueries: (mc.socratesQueries ?? []).map((queryItem: any): SocratesQuery => ({
      id: String(queryItem.id),
      sessionId: String(queryItem.sessionId),
      query: String(queryItem.query ?? ""),
      askedBy: String(queryItem.askedBy ?? "Someone"),
      timeAgo: String(queryItem.timeAgo ?? ""),
    })),
    subscriptions,
    updatedAt: typeof mc.updatedAt === "string" ? mc.updatedAt : null,
  };
}

export function refreshDashboard(projectId: string) {
  return getDashboard(projectId, { forceRefresh: true });
}
