<script lang="ts">
  import { Check } from "lucide-svelte";
  import { type PageItem, PageSearch } from "../editor/page-search.svelte";
  import { tick, untrack } from "svelte";
  import { menuKey } from "$lib/menu-key";
  import { titles } from "$lib/stores/titles.svelte";
  import { local } from "$lib/sync/local.svelte";
  import Highlighted from "../ui/Highlighted.svelte";
  import KindPill from "../ui/KindPill.svelte";
  import PageGlyph from "../ui/PageGlyph.svelte";
  import TextField from "../ui/TextField.svelte";

  let { value, onpick }: { value: readonly string[]; onpick: (ids: string[]) => void } = $props();
  let query = $state("");
  const search = new PageSearch(() => query);

  // The pages chosen when the picker opened come first; ones picked or dropped while it is open stay where they are.
  const chosen = untrack(() => [...value]);
  const items = $derived.by((): PageItem[] => {
    const first = new Set(chosen);
    const found = search.items;
    if (query.trim()) {
      const named = found.filter((item) => !item.group);
      return [...named.filter((item) => first.has(item.id)), ...named.filter((item) => !first.has(item.id)), ...found.filter((item) => item.group)];
    }
    const pinned = chosen.map((id): PageItem => {
      const page = local.page(id);
      const known = titles.get(id);
      return { id, label: page?.title || known?.title || "Untitled", icon: (page ? page.icon : known?.icon) ?? undefined, kind: page?.kind };
    });
    return [...pinned, ...found.filter((item) => !first.has(item.id))];
  });

  // As the other menus: the field is focused once the popup has placed itself, and the arrows (or Ctrl+J / Ctrl+K) move
  // through the pages, Enter toggling the active one.
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();
  let active = $state(0);
  $effect(() => {
    const field = input;
    if (!field) return;
    const frame = requestAnimationFrame(() => field.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  });

  function onkey(event: KeyboardEvent) {
    const key = menuKey(event);
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const n = items.length;
      if (!n) return;
      active = (Math.min(active, n - 1) + (key === "ArrowDown" ? 1 : -1) + n) % n;
      void tick().then(() => list?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" }));
    } else if (key === "Enter") {
      event.preventDefault();
      const item = items[Math.min(active, items.length - 1)];
      if (item) toggle(item);
    }
  }

  function toggle(item: PageItem) {
    titles.remember(item.id, item.label, item.icon ?? null);
    onpick(value.includes(item.id) ? value.filter((id) => id !== item.id) : [...value, item.id]);
  }
</script>

<TextField bind:ref={input} class="mb-1 h-9 w-full" placeholder="Find a page" bind:value={query} oninput={() => (active = 0)} onkeydown={onkey} />
<div class="contents" bind:this={list}>
{#each items as item, index (item.id)}
  {#if item.group && item.group !== items[index - 1]?.group}
    <p class="px-2.5 pt-2 pb-1 text-[12px] font-medium text-ink-45">{item.group}</p>
  {/if}
  <button class="menu-item" data-active={index === active ? "true" : undefined} onmouseenter={() => (active = index)} onclick={() => toggle(item)}>
    <PageGlyph icon={item.icon} kind={item.kind} id={item.id} /><span class="min-w-0 flex-1 truncate"><Highlighted text={item.label} matches={item.matches} /></span><KindPill kind={item.kind} />
    {#if value.includes(item.id)}<Check size={16} />{/if}
  </button>
{/each}
</div>
{#if search.searching}
  <p class="flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-ink-30">
    <span class="size-3.5 animate-spin rounded-full border-2 border-line border-t-ink-45"></span>Searching page text…
  </p>
{/if}
