export function sanitizeCommunicationErrorMessage(message: string | null | undefined) {
  if (!message) {
    return null;
  }

  return message
    .replace(/(xox[baprs]-)[A-Za-z0-9-]+/g, "$1[redacted]")
    .replace(/\bgrn_[A-Za-z0-9._-]+/g, "grn_[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/(access_token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(refresh_token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(id_token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(client_secret=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(webhook_secret=)[^&\s]+/gi, "$1[redacted]");
}

export function errorMessageForPersistence(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return sanitizeCommunicationErrorMessage(message) ?? fallback;
}
