export function encodeCursor(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<TCursor extends Record<string, unknown>>(cursor: string | undefined): TCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as TCursor;
  } catch {
    return null;
  }
}
