import slugify from "slugify";

export function toAnchorId(value: string, orderIndex: number) {
  const slug = slugify(value, { lower: true, strict: true, trim: true }) || `section-${orderIndex + 1}`;
  return `${slug}-${orderIndex + 1}`;
}
