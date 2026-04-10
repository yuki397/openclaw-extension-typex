export function normalizeTypeXTarget(raw: string): string {
  const normalized = raw.replace(/^typex:/i, "").trim();
  if (!normalized) {
    return normalized;
  }

  if (/^dm:/i.test(normalized)) {
    return `user:${normalized.slice(3).trim()}`;
  }

  return normalized;
}
