import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "cs_";
const TOKEN_BYTES = 32;

export function generateClientShareToken(secret: string): {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  const rawToken = `${PREFIX}${raw}`;
  const tokenHash = hashToken(rawToken, secret);
  const tokenPrefix = rawToken.slice(0, PREFIX.length + 8);
  return { rawToken, tokenHash, tokenPrefix };
}

export function hashToken(rawToken: string, secret: string): string {
  return createHmac("sha256", secret).update(rawToken).digest("hex");
}

export function verifyToken(rawToken: string, storedHash: string, secret: string): boolean {
  const computed = hashToken(rawToken, secret);
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
