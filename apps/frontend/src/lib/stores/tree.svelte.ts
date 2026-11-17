import { tick } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { subtreeIds } from "../actions";
import { sidebar } from "./sidebar.svelte";
import { storedJson, storeJson } from "./stored";
import { workspace } from "./workspace.svelte";

const EXPANDED = "keep.expanded";

/** Which pages of the sidebar tree are open, remembered on this device. */
class Tree {
  readonly expanded = new SvelteSet<string>(storedJson<string[]>(EXPANDED, []));
  /** The rows picked with ⌘/⇧-click, for bulk actions; `anchor` is where a ⇧ range starts. */
  readonly selected = new SvelteSet<string>();
  anchor: string | null = null;
  /** The row picked last, by click or ⇧-arrow: drawn stronger than the rest. */
  last = $state<string | null>(null);
  /** Whether ⇧ is down: rows then drop their `href`, so Arc does not offer to open them in a Peek. */
  shift = $state(false);

  /** Selects a row; a collapsed one takes its hidden pages along. */
  pick(id: string) {
    for (const picked of this.expanded.has(id) ? [id] : subtreeIds([id])) this.selected.add(picked);
  }

  unpick(id: string) {
    for (const picked of this.expanded.has(id) ? [id] : subtreeIds([id])) this.selected.delete(picked);
  }

  toggleSelect(id: string) {
    if (this.selected.has(id)) this.unpick(id);
    else this.pick(id);
    this.anchor = id;
    this.last = this.selected.has(id) ? id : null;
  }

  /** Selects the rows from the anchor to `id`, in the order the tree shows them (`order`), keeping what was picked. */
  selectRange(id: string, order: string[], from = this.anchor) {
    const a = order.indexOf(from ?? id);
    const b = order.indexOf(id);
    if (b < 0) return;
    const [lo, hi] = a < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)];
    for (const picked of order.slice(lo, hi + 1)) this.pick(picked);
    this.anchor ??= id;
    this.last = id;
  }

  clearSelection() {
    this.selected.clear();
    this.anchor = null;
    this.last = null;
  }

  set(id: string, open: boolean) {
    if (open === this.expanded.has(id)) return;
    if (open) this.expanded.add(id);
    else this.expanded.delete(id);
    storeJson(EXPANDED, [...this.expanded]);
  }

  /** Expands the page's ancestors and scrolls its row into view, smoothly and without taking focus. */
  async show(id: string | undefined) {
    if (!id || id === workspace.id) return;
    this.#expandTo(id);
    for (let attempt = 0; attempt < 10; attempt++) {
      await tick();
      const row = document.querySelector<HTMLElement>(`[data-tree-id="${id}"]`);
      if (row) return row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  /** Opens the sidebar and every ancestor of the page, and focuses its row (or its nearest shown ancestor's). */
  async reveal(id = workspace.id) {
    if (!id) return;
    sidebar.open = true;
    const parents = this.#expandTo(id);
    await tick();
    for (let at: string | null | undefined = id; at; at = parents.get(at)) {
      const link = document.querySelector<HTMLElement>(`[data-tree-id="${at}"] a`);
      if (!link) continue;
      link.focus();
      link.scrollIntoView({ block: "nearest" });
      return;
    }
  }

  /** Expands every ancestor of the page below the workspace; answers each row's parent, by id. */
  #expandTo(id: string) {
    const parents = new Map(workspace.rows.map((r) => [r.id, r.parentId]));
    for (let at = parents.get(id); at && at !== workspace.id; at = parents.get(at)) this.set(at, true);
    return parents;
  }
}

export const tree = new Tree();
