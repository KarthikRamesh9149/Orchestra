import slugify from "slugify";
import { randomUUID } from "node:crypto";

export function toSlug(value: string) {
  const base = slugify(value, { lower: true, strict: true, trim: true });
  return `${base || "item"}-${randomUUID().slice(0, 8)}`;
}
