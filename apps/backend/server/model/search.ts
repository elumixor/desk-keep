import { go, type Prepared, prepare } from "fuzzysort";

/**
 * The two ways pages are found. By name: titles matched fuzzily (the typed letters in order, whole words and runs of
 * them ranked first), cheap enough to run on every keystroke on the device. By content: full-text over everything a
 * page says, which only the server holds.
 */
export const SEARCH_BY = ["name", "content", "both"] as const;
export type SearchBy = (typeof SEARCH_BY)[number];

export const searchesNames = (by: SearchBy) => by !== "content";
export const searchesContent = (by: SearchBy) => by !== "name";

/** Below this a match is letters scattered too far apart to mean the page. */
const THRESHOLD = 0.3;

/** A title made ready for matching once per object: a synced record is replaced, never changed. */
const prepared = new WeakMap<object, Prepared>();

function target(page: { readonly title: string }) {
  let out = prepared.get(page);
  if (!out) {
    out = prepare(page.title || "Untitled");
    prepared.set(page, out);
  }
  return out;
}

interface NameHit<T> {
  readonly page: T;
  /** 1 is the title itself, 0 barely a match. */
  readonly score: number;
  /** The title's characters the query matched. */
  readonly matches: readonly number[];
}

/** Pages whose title matches the query, best first; none for an empty query. */
export function searchNames<T extends { readonly title: string }>(
  pages: readonly T[],
  query: string,
  limit: number,
): NameHit<T>[] {
  const q = query.trim();
  if (!q) return [];
  return go(q, pages, { key: target, limit, threshold: THRESHOLD }).map((hit) => ({
    page: hit.obj,
    score: hit.score,
    matches: hit.indexes,
  }));
}
