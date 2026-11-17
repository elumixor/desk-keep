import type { Version } from "$lib/api";
import { people } from "$lib/stores/people.svelte";

export type Author = NonNullable<Version["author"]>;

const OTHERS_AFTER = 3;
const list = new Intl.ListFormat(undefined, { type: "conjunction" });

/** A version without an author holds how the page was before its history was kept. */
export const authorName = (author: Version["author"]) =>
  author ? (author.name ?? people.name(author.id) ?? "Someone") : "Earlier edits";

/** Everyone who edited the page, most recent first, each once. */
export const editors = (versions: readonly Version[]): readonly Author[] => [
  ...new Map(versions.flatMap(({ author }) => (author ? [[author.id, author] as const] : []))).values(),
];

/** "Ann, Bob and Cy", or "Ann, Bob, Cy and 4 others" past a few. */
export function names(authors: readonly Author[]) {
  const named = authors.slice(0, OTHERS_AFTER).map(authorName);
  const rest = authors.length - named.length;
  return list.format(rest ? [...named, `${rest} ${rest === 1 ? "other" : "others"}`] : named);
}
