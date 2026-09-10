import { createHash } from "node:crypto";

export function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function stableBodyHash(bodyText: string, bodyHtml?: string | null) {
  return createHash("sha256")
    .update(`${bodyText}\n---\n${bodyHtml ?? ""}`)
    .digest("hex");
}
