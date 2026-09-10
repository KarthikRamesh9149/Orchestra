import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";

type StatePayload = {
  nonce: string;
  provider: string;
  projectId: string;
  issuedAt: number;
};

export function buildOAuthState(env: AppEnv, payload: StatePayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signState(env, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function parseAndVerifyOAuthState(env: AppEnv, state: string) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) {
    throw new AppError(400, "OAuth state is malformed", "oauth_state_invalid");
  }

  const expected = signState(env, encodedPayload);
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new AppError(400, "OAuth state signature is invalid", "oauth_state_invalid");
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as StatePayload;
  } catch {
    throw new AppError(400, "OAuth state payload is invalid", "oauth_state_invalid");
  }
}

export function hashOAuthNonce(nonce: string) {
  return createHash("sha256").update(nonce).digest("hex");
}

function signState(env: AppEnv, encodedPayload: string) {
  return createHmac("sha256", env.CONNECTOR_OAUTH_STATE_SECRET).update(encodedPayload).digest("hex");
}
