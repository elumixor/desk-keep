<script lang="ts">
  import { tick } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fade, fly, scale } from "svelte/transition";
  import { menuKey } from "$lib/menu-key";
  import { pageIdOf } from "$model/urn";
  import { pageEntries } from "$lib/page-menu";
  import { POPUP } from "$lib/popup";
  import { contextMenu, type MenuAction } from "$lib/stores/context-menu.svelte";
  import MenuItem from "./MenuItem.svelte";
  import Separator from "./Separator.svelte";

  /**
   * The app's context menu, drawn once: what `use:menu` or a "…" button asks for, and on any link to a page or
   * mention of one, the page's own. Elsewhere (text, fields, images) the browser's menu stays.
   */
  const MARGIN = 8;
  const PAGE_PATH = /^\/w\/([^/]+)(?:\/p\/([^/]+))?\/?$/;
  const MENTION = '[data-type="mention"][data-id], .mention[data-id]';

  let panel = $state<HTMLDivElement>();
  let position = $state({ top: 0, left: 0 });
  /** The corner it opened from, which it grows out of: the one at the pointer. */
  let origin = $state("top left");
  let active = $state(-1);
  let returnFocus: HTMLElement | null = null;
  const actions = $derived(contextMenu.entries.filter((entry): entry is MenuAction => entry !== "separator"));

  $effect(() => {
    const at = contextMenu.at;
    if (!at || !panel) return;
    const { offsetWidth: w, offsetHeight: h } = panel;
    const [left, up] = [at.x + w > innerWidth - MARGIN, at.y + h > innerHeight - MARGIN];
    position = { left: Math.max(MARGIN, left ? at.x - w : at.x), top: Math.max(MARGIN, up ? at.y - h : at.y) };
    origin = `${up ? "bottom" : "top"} ${left ? "right" : "left"}`;
    active = -1;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus();
  });

  $effect(() => {
    const owner = contextMenu.owner;
    owner?.setAttribute("data-menu-open", "");
    return () => owner?.removeAttribute("data-menu-open");
  });

  function close() {
    contextMenu.hide();
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  async function run(action: MenuAction) {
    close();
    await tick();
    action.run();
  }

  /** The page a link or a mention under the pointer stands for. */
  function pageAt(target: Element): string | null {
    const mention = target.closest<HTMLElement>(MENTION)?.dataset.id;
    // A person mentioned is no page.
    if (mention) return mention.includes(":") ? pageIdOf(mention) : mention;
    const href = target.closest("a[href]")?.getAttribute("href");
    if (!href) return null;
    const canonical = pageIdOf(href);
    if (canonical) return canonical;
    const url = new URL(href, location.origin);
    const match = url.origin === location.origin ? PAGE_PATH.exec(url.pathname) : null;
    return match ? (match[2] ?? match[1]) : null;
  }

  function onContextMenu(event: MouseEvent) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (panel?.contains(event.target)) return event.preventDefault();
    const id = pageAt(event.target);
    if (!id) return close();
    event.preventDefault();
    contextMenu.showFor(event, pageEntries(id), event.target.closest(`a[href], ${MENTION}`));
  }

  function onKey(event: KeyboardEvent) {
    const key = menuKey(event);
    const n = actions.length;
    if (key === "ArrowDown" || key === "ArrowUp") active = (active + (key === "ArrowDown" ? 1 : n - (active < 0 ? 0 : 1))) % n;
    else if (key === "Home" || key === "End") active = key === "Home" ? 0 : n - 1;
    else if ((key === "Enter" || key === " ") && actions[active]) void run(actions[active]);
    else if (key === "Escape" || key === "Tab") close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerDown(event: PointerEvent) {
    const target = event.target as Element;
    if (contextMenu.at && !panel?.contains(target) && !target.closest?.("[data-menu-trigger]")) contextMenu.hide();
  }
</script>

<svelte:window
  oncontextmenu={onContextMenu}
  onpointerdowncapture={onPointerDown}
  onresize={() => contextMenu.hide()}
  onblur={() => contextMenu.hide()}
  onscrollcapture={(e) => !panel?.contains(e.target as Node) && contextMenu.hide()}
/>

{#if contextMenu.at}
  {#key contextMenu.at}
  <!-- It grows out of the pointer, its entries following one after another, as a popover opens. -->
  <div
    in:scale|global={{ start: 0.94, duration: 160, easing: cubicOut }}
    out:fade={{ duration: 90 }}
    bind:this={panel}
    role="menu"
    tabindex="-1"
    data-popover
    class="fixed z-[60] max-h-[min(28rem,calc(100dvh-1rem))] w-56 overflow-y-auto outline-none {POPUP}"
    style="top: {position.top}px; left: {position.left}px; transform-origin: {origin}"
    onkeydown={onKey}
  >
    {#each contextMenu.entries as entry, index (index)}
      {#if entry === "separator"}
        <div in:fade|global={{ duration: 160, delay: index * 18 }}><Separator /></div>
      {:else}
        {@const Icon = entry.icon}
        <div role="none" in:fly|global={{ y: -4, duration: 180, delay: index * 18, easing: cubicOut }} onmouseenter={() => (active = actions.indexOf(entry))}>
          <MenuItem danger={entry.danger} active={actions[active] === entry} onclick={() => void run(entry)}><Icon size={16} /> {entry.label}</MenuItem>
        </div>
      {/if}
    {/each}
  </div>
  {/key}
{/if}
