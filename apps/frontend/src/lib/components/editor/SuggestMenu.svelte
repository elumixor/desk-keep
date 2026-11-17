<script lang="ts">
  import { POPUP } from "$lib/popup";
  import Highlighted from "../ui/Highlighted.svelte";
  import KindPill from "../ui/KindPill.svelte";
  import PageGlyph from "../ui/PageGlyph.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import type { MenuItem, MenuState } from "./menu.svelte";

  /** What `menuRenderer` draws under the caret: grouped rows, each an icon, a label, and a description or a hint. */
  let { menu, onpick }: { menu: MenuState<MenuItem>; onpick: (item: MenuItem) => void } = $props();

  let list = $state<HTMLDivElement>();
  const rich = $derived(menu.items.some((item) => item.description));

  $effect(() => {
    void menu.selected;
    list?.querySelector<HTMLElement>("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  });
</script>

<div
  bind:this={list}
  class="max-h-[min(22rem,60dvh)] overflow-y-auto {POPUP} {rich ? 'w-80' : 'w-72'}"
  role="listbox"
>
  {#each menu.items as item, index (index)}
    {#if item.group && item.group !== menu.items[index - 1]?.group}
      <p class="px-2 pt-2 pb-1 text-[12px] font-medium text-ink-45 {index > 0 ? 'mt-1' : ''}">{item.group}</p>
    {/if}
    <button
      type="button"
      data-active={index === menu.selected}
      class="menu-item {item.description ? 'py-1.5' : ''}"
      onmouseenter={() => (menu.selected = index)}
      onmousedown={(event) => {
        event.preventDefault();
        onpick(item);
      }}
    >
      {#if item.description}
        <span class="grid size-10 shrink-0 place-items-center rounded-sm bg-surface text-ink-70 shadow-panel">
          {#if typeof item.icon === "string"}<IconGlyph icon={item.icon} size={20} />{:else if item.icon}<item.icon size={20} />{/if}
        </span>
      {:else if item.avatar}
        <span class="grid size-5 shrink-0 place-items-center"><Avatar name={item.avatar.name} src={item.avatar.src} /></span>
      {:else}
        <span class="grid size-5 shrink-0 place-items-center text-ink-45">
          {#if typeof item.icon === "string"}<PageGlyph icon={item.icon} kind={item.kind} />{:else if item.icon}<item.icon size={16} />{:else}<PageGlyph icon={null} kind={item.kind} />{/if}
        </span>
      {/if}
      <span class="min-w-0 flex-1">
        <span class="block truncate"><Highlighted text={item.label} matches={item.matches} /></span>
        {#if item.description}<span class="block truncate text-[12px] text-ink-45">{item.description}</span>{/if}
      </span>
      <KindPill kind={item.kind} />
      {#if item.hint}<span class="max-w-32 shrink-0 truncate font-mono text-[12px] text-ink-30">{item.hint}</span>{/if}
    </button>
  {:else}
    {#if !menu.loading && !menu.searching}<p class="px-2 py-1.5 text-ink-30">No matches</p>{/if}
  {/each}
  {#if menu.searching || (menu.loading && !menu.items.length)}
    <p class="flex items-center gap-2 px-2 py-1.5 text-[13px] text-ink-30">
      <span class="size-3.5 animate-spin rounded-full border-2 border-line border-t-ink-45"></span>{menu.items.length ? "Searching page text…" : "Searching…"}
    </p>
  {/if}
</div>
