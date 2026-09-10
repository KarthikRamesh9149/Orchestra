import { createHash } from "node:crypto";

export interface JwtUser {
  userId: string;
  orgId: string;
  sessionId?: string;
  organizationMembershipId?: string;
  workspaceRoleDefault: "manager" | "dev" | "client";
  globalRole: "owner" | "admin" | "member";
}

export type JwtTokenType = "access" | "refresh";

export type TypedJwtUser<TType extends JwtTokenType = JwtTokenType> = JwtUser & {
  typ: TType;
  jti?: string;
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
