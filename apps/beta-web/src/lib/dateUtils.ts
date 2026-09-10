/**
 * Returns a human-readable distance string from a timestamp.
 * Accepts ISO date strings or relative strings like "Yesterday · 3:42 PM".
 */
export function formatDistanceToNow(timestamp: string): string {
  if (!timestamp) return "";

  // Already a relative string from mock data (not an ISO date)
  if (!timestamp.includes("T") && !timestamp.includes("-")) {
    // Split at " · " and return just the first part
    return timestamp.split(" · ")[0] ?? timestamp;
  }

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;

  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
