/** The inline node a date in text is: `attrs.date` is the day, `YYYY-MM-DD`. */
export const DATE_NODE = "date";

const WORDS = [
  ["today", 0],
  ["tomorrow", 1],
  ["yesterday", -1],
] as const;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** A day as `YYYY-MM-DD`, in the clock's own time zone. */
export const isoDay = (at: Date) => `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** The day `YYYY-MM-DD` names, at local midnight; null for anything else, or a day the calendar lacks. */
export function parseDay(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? exact(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function exact(year: number, month: number, day: number): Date | null {
  const at = new Date(year, month - 1, day);
  return at.getFullYear() === year && at.getMonth() === month - 1 && at.getDate() === day ? at : null;
}

/** A date written `d.m.y` or `d/m/y` (a two-digit year is 20yy; no year is this one), as `YYYY-MM-DD`; null if it is not one. */
export function writtenDay(text: string, now = new Date()): string | null {
  const match = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : now.getFullYear();
  const at = exact(year, Number(match[2]), Number(match[1]));
  return at ? isoDay(at) : null;
}

/** The days a query names: `today`, `tomorrow` and `yesterday` by their first letters, or a date written out. */
export function daysFor(query: string, now = new Date()): { readonly word?: string; readonly date: string }[] {
  const q = query.trim().toLowerCase();
  const written = writtenDay(q, now);
  if (written) return [{ date: written }];
  if (!q || !/^[a-z]+$/.test(q)) return [];
  return WORDS.filter(([word]) => word.startsWith(q)).map(([word, offset]) => ({
    word,
    date: isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)),
  }));
}

/** A date node as text: the day, or `start → end` for a range. */
export function dateNodeText(attrs: Readonly<Record<string, unknown>> | undefined) {
  const start = typeof attrs?.date === "string" ? attrs.date : "";
  return typeof attrs?.end === "string" && attrs.end ? `${start} → ${attrs.end}` : start;
}
