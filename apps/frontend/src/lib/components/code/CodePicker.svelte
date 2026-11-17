<script lang="ts" generics="T extends MenuItem">
  import { POPUP } from "$lib/popup";
  import type { MenuItem, MenuState } from "../editor/menu.svelte";
  import SuggestMenu from "../editor/SuggestMenu.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * What a script's `page(` or `.prop(` picks, under the caret: a page from the app's search, a property of the page.
   * It takes the keys while open, as a field of its own (Vim's keys stay with the code): typing searches, Ctrl+J/K or
   * the arrows move, Enter or Tab picks, Escape closes it, leaving the code as it was. `search` answers the items for
   * what is typed.
   */
  let {
    initial,
    x,
    y,
    label,
    search,
    onpick,
    oncancel,
  }: {
    initial: string;
    x: number;
    y: number;
    label: string;
    search: (query: () => string) => { readonly items: T[]; readonly searching?: boolean };
    onpick: (item: T) => void;
    oncancel: () => void;
  } = $props();
  // svelte-ignore state_referenced_locally
  let query = $state(initial);
  let input = $state<HTMLInputElement>();
  // svelte-ignore state_referenced_locally
  const found = search(() => query);
  const menu = $state<MenuState<T>>({ items: [], selected: 0 });

  $effect(() => {
    menu.items = found.items;
    menu.searching = found.searching;
  });
  $effect(() => {
    void query;
    menu.selected = 0;
  });
  $effect(() => input?.focus());

  function move(by: number) {
    const n = menu.items.length;
    if (n) menu.selected = (menu.selected + by + n) % n;
  }

  function onkeydown(event: KeyboardEvent) {
    const ctrl = event.ctrlKey && !event.metaKey;
    if (event.key === "ArrowDown" || (ctrl && event.key === "j")) move(1);
    else if (event.key === "ArrowUp" || (ctrl && event.key === "k")) move(-1);
    else if (event.key === "Enter" || event.key === "Tab") {
      const item = menu.items[menu.selected];
      if (item) onpick(item);
    } else if (event.key === "Escape") oncancel();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<div class="fixed z-[60] flex w-72 flex-col gap-1" style="left: {x}px; top: {y}px">
  <div class={POPUP}>
    <TextField variant="bare" bind:ref={input} bind:value={query} class="h-7 w-full px-1.5" placeholder={label} aria-label={label}
      {onkeydown} onblur={oncancel} />
  </div>
  <SuggestMenu {menu} onpick={(item) => onpick(item as T)} />
</div>
