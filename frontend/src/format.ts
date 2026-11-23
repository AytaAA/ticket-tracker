// Timestamps come from the API in UTC (ISO-8601 with Z) and are shown in UTC, e.g. "2026-11-23 10:15 UTC".
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
