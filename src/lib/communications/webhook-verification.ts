import { AppError } from "../../app/errors.js";

export function assertWebhookVerificationNotImplemented(provider: string): never {
  throw new AppError(
    501,
    `${provider} webhook verification is not implemented in communication layer C1`,
    "communication_webhook_not_implemented"
  );
}
