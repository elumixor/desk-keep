import type { SearchHit } from "$lib/api";
import { getJson } from "$lib/http";
import { workspace } from "$lib/stores/workspace.svelte";
import { pageRecords } from "$lib/sync/client.svelte";
import { local } from "$lib/sync/local.svelte";
import type { NodeKind } from "$model/nodes";
import { searchNames } from "$model/search";
import type { PageRecord } from "$model/sync";

export interface PageItem {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: string;
  readonly kind?: NodeKind;
  /** The label's characters the query matched. */
  readonly matches?: readonly number[];
  /** Set on the pages found by what they say rather than by name. */
  readonly group?: string;
}

const LIMIT = 50;
export const CONTENT_GROUP = "In the text";

const newest = (a: PageRecord, b: PageRecord) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/**
 * Every place pages are looked for (`@`, a relation, `space e`, ⌘K) searches the same two ways: by name first, from
 * the records on the device, so it answers at once and offline; then by content, which only the server can search.
 */

/** A page as a search box lists it, its parent as the hint unless that is the workspace's top level. */
export const pageItem = (page: PageRecord, matches?: readonly number[]): PageItem => ({
  id: page.id,
  label: page.title || "Untitled",
  hint: page.parentId && page.parentId !== workspace.id ? local.page(page.parentId)?.title || "Untitled" : undefined,
  icon: page.icon ?? undefined,
  kind: page.kind,
  matches,
});

/** Pages by name, best first; the last edited before anything is typed. */
export function pagesByName(query: string): PageItem[] {
  const id = workspace.id;
  if (!id) return [];
  const pages = pageRecords.all.filter((p) => p.workspaceId === id);
  if (!query.trim())
    return pages
      .filter((p) => p.id !== id)
      .toSorted(newest)
      .slice(0, LIMIT)
      .map((page) => pageItem(page));
  return searchNames(pages, query, LIMIT).map((hit) => pageItem(hit.page, hit.matches));
}

/** Pages whose text holds the words, without the ones already shown. */
export async function pagesByContent(
  query: string,
  shown: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<PageItem[]> {
  const id = workspace.id;
  if (!id || !query.trim()) return [];
  const hits = await getJson<SearchHit[]>(`/api/workspaces/${id}/search`, { q: query, by: "content" }, signal);
  return hits
    .filter((hit) => !shown.has(hit.id))
    .map((hit) => ({
      id: hit.id,
      label: hit.title || "Untitled",
      hint: hit.parentTitle ?? undefined,
      icon: hit.icon ?? undefined,
      group: CONTENT_GROUP,
    }));
}

/** How long typing pauses before the server is asked. */
const CONTENT_DELAY_MS = 120;

/** A search box's pages: by name as the query changes, then by content once typing pauses. Made in a component. */
export class PageSearch {
  readonly query: () => string;
  readonly byName = $derived.by(() => pagesByName(this.query()));
  #byContent = $state<{ query: string; items: PageItem[] }>({ query: "", items: [] });
  /** The server is being asked; the pages by name already show. */
  searching = $state(false);
  readonly items = $derived.by(() => {
    const named = new Set(this.byName.map((p) => p.id));
    const content = this.#byContent.query === this.query().trim() ? this.#byContent.items : [];
    return [...this.byName, ...content.filter((p) => !named.has(p.id))];
  });

  constructor(query: () => string) {
    this.query = query;
    $effect(() => {
      const q = this.query().trim();
      if (!q) {
        this.searching = false;
        return;
      }
      const controller = new AbortController();
      this.searching = true;
      const timer = setTimeout(() => {
        pagesByContent(q, new Set(), controller.signal).then(
          (items) => {
            this.#byContent = { query: q, items };
            this.searching = false;
          },
          (error) => {
            if (controller.signal.aborted) return;
            console.warn("[search] by content", error);
            this.searching = false;
          },
        );
      }, CONTENT_DELAY_MS);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    });
  }
}
