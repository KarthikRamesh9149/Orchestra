import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function createGitHubWebhookSignature(rawBody: string, secret: string) {
  return `${SIGNATURE_PREFIX}${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyGitHubWebhookSignature(rawBody: string, signature: string | undefined, secret: string) {
  if (!rawBody || !signature || !secret || !signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expected = createGitHubWebhookSignature(rawBody, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
