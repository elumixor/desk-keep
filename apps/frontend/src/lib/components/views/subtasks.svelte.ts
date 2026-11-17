import { CornerDownRight, Plus } from "lucide-svelte";
import { SvelteSet } from "svelte/reactivity";
import type { MenuEntries } from "$lib/stores/context-menu.svelte";

/** A page added in a view by a row: right after it, or as its child. */
export type Place = (id: string, where: "after" | "inside", properties?: Record<string, unknown>) => void;

/** What a row's context menu offers for adding pages by it. */
export const placeEntries = (add: (where: "after" | "inside") => void): MenuEntries => [
  { label: "Add after", icon: Plus, run: () => add("after") },
  { label: "Add child", icon: CornerDownRight, run: () => add("inside") },
];

/** A row as a view lays it out with its subtasks: how deep it sits and how many of the view's pages are right under it. */
export interface NestedRow<R> {
  readonly row: R;
  readonly depth: number;
  readonly children: number;
}

/** Per view, the rows whose subtasks are shown, remembered on this device. */
const opened = new Map<string, SvelteSet<string>>();

const keyOf = (viewId: string) => `keep.subtasks.${viewId}`;

function openIn(viewId: string) {
  let set = opened.get(viewId);
  if (!set) {
    let saved: string[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(keyOf(viewId)) ?? "[]");
    } catch {
      saved = [];
    }
    set = new SvelteSet(saved);
    opened.set(viewId, set);
  }
  return set;
}

function remember(viewId: string, set: SvelteSet<string>) {
  try {
    localStorage.setItem(keyOf(viewId), JSON.stringify([...set]));
  } catch (error) {
    console.warn("[subtasks] could not remember which rows are open", error);
  }
}

/**
 * Subtasks are the pages a view shows that sit right under another page it shows: they are drawn under it, one level
 * in, while it is open. A page whose parent the view does not show stays at the top.
 */
export const subtasks = {
  isOpen: (viewId: string, id: string) => openIn(viewId).has(id),

  toggle(viewId: string, id: string) {
    const set = openIn(viewId);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    remember(viewId, set);
  },

  open(viewId: string, id: string) {
    const set = openIn(viewId);
    if (set.has(id)) return;
    set.add(id);
    remember(viewId, set);
  },

  /** The rows in the order the view shows them, each followed by its subtasks when it is open. */
  nest<R extends { readonly id: string; readonly parentId?: string | null }>(viewId: string, rows: readonly R[]) {
    const set = openIn(viewId);
    const ids = new Set(rows.map((r) => r.id));
    const under = new Map<string, R[]>();
    const top: R[] = [];
    for (const row of rows) {
      const parent = row.parentId;
      if (parent && ids.has(parent)) under.set(parent, [...(under.get(parent) ?? []), row]);
      else top.push(row);
    }
    const out: NestedRow<R>[] = [];
    const walk = (row: R, depth: number) => {
      const children = under.get(row.id) ?? [];
      out.push({ row, depth, children: children.length });
      if (set.has(row.id)) for (const child of children) walk(child, depth + 1);
    };
    for (const row of top) walk(row, 0);
    return { rows: out, nested: under.size > 0 };
  },
};
