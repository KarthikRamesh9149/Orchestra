export type UserRole = "admin" | "member";
export type DeviceType = "laptop" | "phone" | "tablet" | "browser";

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  avatarUrl?: string;
  initials: string;
  avatarColor: string;
  role: UserRole;
  title?: string;
  timezone: string;
  bio?: string;
  updatedAt: string;
  joinedAt: string;
};

export type NotificationPref = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};

export type Session = {
  id: string;
  device: string;
  deviceType: DeviceType;
  location: string;
  lastActiveAt: string;
  isCurrent: boolean;
  organizationName: string | null;
  expiresAt: string | null;
  status: "active" | "revoked" | "expired";
};

export type Workspace = {
  id: string;
  name: string;
  role: UserRole;
  isCurrent: boolean;
  color: string;
};

export type LinkedAccount = {
  id: string;
  service: "google" | "github" | "microsoft";
  connected: boolean;
  accountIdentifier?: string;
  status: string;
  linkedAt: string;
  sources: string[];
};

export type AppearancePrefs = {
  theme: "light" | "dark" | "auto";
  reduceMotion: boolean;
};
