export type DashboardStat = {
  id: string;
  label: string;
  value: string;
  iconBg: string;
  iconColor: string;
  trend: number[];
  route: string;
};

export type TeamMember = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: "manager" | "dev" | "client";
};

export type CalendarEvent = {
  id: string;
  title: string;
  day: string;
  time: string;
  startsAt: string;
  endsAt: string | null;
  duration?: string;
};

export type RecentChange = {
  id: string;
  title: string;
  status: "accepted" | "pending" | "rejected" | "needs_review";
  timeAgo: string;
};

export type SlackMessage = {
  id: string;
  threadId: string;
  channelName: string | null;
  accountLabel: string | null;
  authorName: string;
  initials: string;
  avatarColor: string;
  timeAgo: string;
  preview: string;
};

export type GitCommit = {
  hash: string;
  message: string;
  author: string;
  timeAgo: string;
  repository: string | null;
  branch: string | null;
};

export type ActivityItem = {
  id: string;
  source:
    | "slack"
    | "github"
    | "socrates"
    | "calendar"
    | "manual"
    | "vscode"
    | "document"
    | "google_drive"
    | "notion"
    | "approval"
    | "microsoft_teams"
    | "zoho_mail"
    | "zoho_cliq"
    | "zoho_crm";
  text: string;
  timeAgo: string;
  route: string;
};

export type SocratesQuery = {
  id: string;
  sessionId: string;
  query: string;
  askedBy: string;
  timeAgo: string;
};

export type Subscription = {
  id: string;
  name: string;
  category: string;
  cost: number;
  billingType: "monthly" | "annual" | "per_transaction" | "one_time" | "usage_based";
  status: "active" | "paused" | "cancelled";
  provider: string | null;
  externalRef: string | null;
  renewsAt: string | null;
  iconLabel: string;
  iconBg: string;
  iconTextColor: string;
};

export type SubscriptionInput = Omit<Subscription, "id" | "iconLabel" | "iconBg" | "iconTextColor">;
