import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { FileText } from "lucide-svelte";
import { type Component, mount, unmount } from "svelte";
import { menuKey } from "$lib/menu-key";
import type { NodeKind } from "$model/nodes";
import SuggestMenu from "./SuggestMenu.svelte";

export interface MenuItem {
  readonly label: string;
  readonly hint?: string;
  readonly description?: string;
  /** An emoji, or a lucide icon component; a page without one shows the page icon. */
  readonly icon?: string | typeof FileText;
  readonly group?: string;
  /** Set on a page: a trait or a view says so in a pill. */
  readonly kind?: NodeKind;
  /** The label's characters a search matched, drawn bold. */
  readonly matches?: readonly number[];
  /** Set on a person: their picture (or initial) in place of the icon. */
  readonly avatar?: { readonly name: string; readonly src: string | null };
}

export interface MenuState<T> {
  items: T[];
  selected: number;
  /** The items are being fetched: the ones shown are the last query's. */
  loading?: boolean;
  /** `more` is fetching what follows the items shown. */
  searching?: boolean;
}

export interface MenuProps<T> {
  menu: MenuState<T>;
  onpick: (item: T) => void;
}

const GAP = 4;
const MARGIN = 8;
/** How long typing pauses before `more` asks. */
const MORE_DELAY_MS = 120;

/**
 * The dropdown every editor trigger (`@`, `/`, `:`) shows under the caret: a Svelte component mounted by hand,
 * because ProseMirror calls this outside of any. Arrow keys move, Enter or Tab picks, Escape closes. A grid of `columns`
 * (the emoji's) moves sideways too; with `hideEmpty` nothing shows, and no key is taken, while nothing matches.
 */
export function menuRenderer<T extends MenuItem>({
  component = SuggestMenu as unknown as Component<MenuProps<T>>,
  columns = 1,
  hideEmpty = false,
  more,
}: {
  component?: Component<MenuProps<T>>;
  columns?: number;
  hideEmpty?: boolean;
  /** Slower items to show after the ones the suggestion gives, such as what only the server can find. */
  more?: (query: string, shown: readonly T[], signal: AbortSignal) => Promise<T[]>;
} = {}) {
  let host: HTMLDivElement | null = null;
  let instance: ReturnType<typeof mount> | null = null;
  let props: SuggestionProps<T> | null = null;
  const state = $state<MenuState<T>>({ items: [], selected: 0, loading: false, searching: false });
  /** The query `more` was last asked for, and what it answered. */
  let asked: string | null = null;
  let extra: T[] = [];
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopMore = () => {
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    state.searching = false;
  };

  const askMore = (query: string) => {
    stopMore();
    asked = query;
    extra = [];
    if (!more || !query.trim()) return;
    const own = new AbortController();
    controller = own;
    state.searching = true;
    timer = setTimeout(() => {
      more(query, state.items, own.signal)
        .then((found) => {
          if (own.signal.aborted) return;
          extra = found;
          state.items = [...state.items, ...found];
        })
        .catch((error) => {
          if (!own.signal.aborted) console.warn("[menu] more items", error);
        })
        .finally(() => {
          if (controller !== own) return;
          controller = null;
          state.searching = false;
          requestAnimationFrame(place);
        });
    }, MORE_DELAY_MS);
  };

  /** Tiptap hands over no items while it fetches; the last ones stay until the new ones come. */
  const take = (next: SuggestionProps<T>) => {
    props = next;
    state.loading = !!next.loading;
    if (next.loading) return;
    const same = next.query === asked;
    state.items = same ? [...next.items, ...extra] : next.items;
    state.selected = same ? Math.min(state.selected, Math.max(0, state.items.length - 1)) : 0;
    if (!same) askMore(next.query);
  };

  const place = () => {
    const rect = props?.clientRect?.();
    if (!host || !rect) return;
    host.hidden = hideEmpty && !state.items.length && !state.searching;
    const { offsetWidth: w, offsetHeight: h } = host;
    const left = Math.min(Math.max(MARGIN, rect.left), innerWidth - w - MARGIN);
    const below = rect.bottom + GAP;
    const top = below + h > innerHeight - MARGIN && rect.top - h - GAP > MARGIN ? rect.top - h - GAP : below;
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  };

  const close = () => {
    stopMore();
    asked = null;
    extra = [];
    if (instance) void unmount(instance);
    host?.remove();
    instance = null;
    host = null;
  };

  return {
    onStart(next: SuggestionProps<T>) {
      state.items = [];
      state.selected = 0;
      take(next);
      host = document.createElement("div");
      host.className = "fixed z-50";
      document.body.append(host);
      instance = mount(component, { target: host, props: { menu: state, onpick: (item: T) => props?.command(item) } });
      requestAnimationFrame(place);
      place();
    },
    onUpdate(next: SuggestionProps<T>) {
      take(next);
      requestAnimationFrame(place);
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      const count = state.items.length;
      if (hideEmpty && !count) return false;
      const key = menuKey(event);
      const move = (by: number) => (state.selected = (state.selected + by + count * columns) % Math.max(count, 1));
      if (key === "ArrowDown") move(columns);
      else if (key === "ArrowUp") move(-columns);
      else if (columns > 1 && event.key === "ArrowRight") move(1);
      else if (columns > 1 && event.key === "ArrowLeft") move(-1);
      else if (event.key === "Enter" || event.key === "Tab") {
        const item = state.items[state.selected];
        if (item) props?.command(item);
        return true;
      } else if (event.key === "Escape") {
        close();
        return true;
      } else return false;
      return true;
    },
    onExit() {
      close();
      props = null;
    },
  };
}
