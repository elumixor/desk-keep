import { parseDay } from "$model/dates";

// The relative times every desk app says the same way.
export { ago, brief, clock, day, sameMinute, stamp } from "@desk/core";

const DAY_MS = 24 * 60 * 60 * 1000;
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();

export const DATE_FORMAT_LABELS = {
  short: "Short (Jan 1)",
  long: "Long (January 1, 2026)",
  full: "Full (Thursday, January 1, 2026)",
  numeric: "Numeric (1/1/2026)",
  iso: "ISO (2026-01-01)",
  relative: "Relative (in 3 days)",
} as const;

export const NUMBER_FORMAT_LABELS = {
  plain: "Number (1234.5)",
  usd: "Dollars ($14.20)",
  minutes: "Minutes (1h 12m)",
} as const;

/** A day (`YYYY-MM-DD…`) as a property's date format reads it. */
export function formatDay(iso: string, format: keyof typeof DATE_FORMAT_LABELS = "short", now = new Date()) {
  const day = iso.slice(0, 10);
  const date = new Date(`${day}T00:00:00`);
  switch (format) {
    case "iso":
      return day;
    case "numeric":
      return date.toLocaleDateString(undefined, { year: "numeric", month: "numeric", day: "numeric" });
    case "long":
      return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    case "full":
      return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    case "relative": {
      const days = Math.round((date.getTime() - startOfDay(now)) / DAY_MS);
      return relative.format(days, "day");
    }
    default:
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}

/** A date node's days: one label, or `start → end`. */
export const dateRangeLabel = (start: string, end?: string | null, now = new Date()) =>
  end ? `${dateLabel(start, now)} → ${dateLabel(end, now)}` : dateLabel(start, now);

/** A day (`YYYY-MM-DD`) as text sits it: "Today", "Tomorrow", "Yesterday", else "Mon, Nov 9" (with the year when not this one). */
export function dateLabel(iso: string, now = new Date()) {
  const date = parseDay(iso);
  if (!date) return iso;
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const year = date.getFullYear() === now.getFullYear() ? undefined : "numeric";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year });
}
