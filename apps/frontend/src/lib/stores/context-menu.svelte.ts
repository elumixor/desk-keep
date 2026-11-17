import type { Trash2 } from "lucide-svelte";

export interface MenuAction {
  readonly label: string;
  readonly icon: typeof Trash2;
  readonly run: () => void;
  readonly danger?: boolean;
}

/** A row of a context menu, or the line between two groups of them. */
export type MenuEntry = MenuAction | "separator";

/** What a right click on something offers; `false` and `null` entries are left out, so a list can hold conditionals. */
export type MenuEntries = readonly (MenuEntry | false | null | undefined)[];

/** The one context menu of the app: what it offers, where, and the element it was opened on (kept highlighted). */
class ContextMenu {
  entries = $state<readonly MenuEntry[]>([]);
  at = $state<{ readonly x: number; readonly y: number } | null>(null);
  owner = $state<Element | null>(null);

  show(at: { readonly x: number; readonly y: number }, entries: MenuEntries, owner: Element | null = null) {
    // Separators only between groups: none first, last or twice in a row.
    const kept = entries.filter((entry): entry is MenuEntry => !!entry);
    const action = (entry: MenuEntry) => entry !== "separator";
    this.entries = kept.filter(
      (entry, i) =>
        action(entry) ||
        (kept.slice(0, i).some(action) && kept.slice(i + 1).some(action) && kept[i - 1] !== "separator"),
    );
    if (!this.entries.length) return this.hide();
    this.at = at;
    this.owner = owner;
  }

  /** Opened by the mouse at the pointer; by the keyboard (the menu key, Shift+F10, no pointer), under `owner`. */
  showFor(event: MouseEvent, entries: MenuEntries, owner: Element | null = null) {
    const box = owner?.getBoundingClientRect();
    const byKeyboard = !event.clientX && !event.clientY && box;
    this.show(byKeyboard ? { x: box.left, y: box.bottom } : { x: event.clientX, y: event.clientY }, entries, owner);
  }

  /**
   * From a "…" button (marked `data-menu-trigger`, so pressing it does not close the menu first): under it, or closed
   * when open for `owner` already, which is what it is about.
   */
  toggleBelow(button: Element, entries: MenuEntries, owner: Element = button) {
    if (this.owner === owner) return this.hide();
    const box = button.getBoundingClientRect();
    this.show({ x: box.left, y: box.bottom + 4 }, entries, owner);
  }

  hide() {
    this.at = null;
    this.owner = null;
  }
}

export const contextMenu = new ContextMenu();

/** Where the browser's own menu stays: spelling, paste and the like belong to what is being typed. */
const FIELD = 'input, textarea, select, [contenteditable="true"]';

/**
 * `use:menu={() => entries}`: a right click on the element opens the context menu with them instead of the
 * browser's, except in a field inside it. Entries are read on the click, so they follow the element's state.
 */
export function menu(node: HTMLElement, entries: () => MenuEntries) {
  let read = entries;
  const open = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target !== node && event.target.closest(FIELD)) return;
    event.preventDefault();
    event.stopPropagation();
    contextMenu.showFor(event, read(), node);
  };
  node.addEventListener("contextmenu", open);
  return {
    update: (next: () => MenuEntries) => (read = next),
    destroy: () => node.removeEventListener("contextmenu", open),
  };
}
