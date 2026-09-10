export type IntegrationKind =
  | "vscode"
  | "slack"
  | "github"
  | "calendar"
  | "drive"
  | "gmail"
  | "clickup"
  | "granola"
  | "fireflies"
  | "zoho"
  | "notion"
  | "teams"
  | "generic";
export type IntegrationStatus = "connected" | "available" | "unavailable" | "needs_attention";
export type MemberRole = "manager" | "dev" | "client";
export type MemberStatus = "active" | "pending";
export type WorkspacePlan = "beta" | "pro" | "enterprise";

export type Integration = {
  id: string;
  name: string;
  kind: IntegrationKind;
  description: string;
  status: IntegrationStatus;
  connectorId?: string;
  capabilities: {
    canConnect: boolean;
    canSync: boolean;
    canDisconnect: boolean;
  };
  readiness: {
    state: string;
    reasons: string[];
    deferredFeatures: string[];
  };
  meta?: string;
  disclaimer?: string;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  plan: WorkspacePlan;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  initials: string;
  avatarColor: string;
  role: MemberRole;
  canApproveTruthChanges: boolean;
  status: MemberStatus;
  isCurrentUser: boolean;
};

export type WorkspaceInvite = {
  id: string;
  code: string | null;
  codePrefix: string;
  invitedEmail: string;
  projectRole: MemberRole;
  canApproveTruthChanges: boolean;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  emailDeliveryStatus: "sent" | "manual_required" | "failed" | "pending";
  emailDeliveryProvider: string | null;
  emailSentAt: string | null;
  emailDeliveryError: string | null;
  state: "pending" | "redeemed" | "expired" | "revoked";
};
