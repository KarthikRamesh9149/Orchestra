import { createHash, randomBytes } from "node:crypto";

const ACTIVATION_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const projectJoinCodePattern = /^(?:[A-HJ-NP-Z2-9]{6}|ORCH-[A-Z0-9]{6}-[A-Z0-9]{6})$/;

export function normalizeProjectJoinCode(code: string) {
  return code.trim().toUpperCase();
}

export function hashProjectJoinCode(code: string) {
  return createHash("sha256").update(normalizeProjectJoinCode(code)).digest("hex");
}

export function getProjectJoinCodePrefix(code: string) {
  return normalizeProjectJoinCode(code).slice(0, 3);
}

export function generateProjectJoinCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => ACTIVATION_ALPHABET[byte % ACTIVATION_ALPHABET.length]).join("");
}

export function generateProjectInviteLinkToken() {
  return randomBytes(32).toString("base64url");
}
