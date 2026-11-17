<script lang="ts">
  import { Check } from "lucide-svelte";
  import { tick, untrack } from "svelte";
  import { menuKey } from "$lib/menu-key";
  import { traits } from "$lib/stores/traits.svelte";
  import { local } from "$lib/sync/local.svelte";
  import { searchNames } from "$model/search";
  import Highlighted from "../ui/Highlighted.svelte";
  import PageGlyph from "../ui/PageGlyph.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * The traits a view keeps to, picked as pages are in a relation: a field, the traits chosen when it opened, then the
   * rest (best match first while typing), each with how many pages have it and where it sits; a click or Enter toggles.
   */
  let { value, onchange }: { value: readonly string[]; onchange: (ids: string[]) => void } = $props();

  let query = $state("");
  const chosen = untrack(() => [...value]);
  type Item = { trait: (typeof traits.list)[number]; matches?: readonly number[] };
  const items = $derived.by((): Item[] => {
    const all = traits.list;
    const q = query.trim();
    const found: Item[] = q
      ? searchNames(all.map((t) => ({ ...t, title: t.name })), q, 50).map((hit) => ({ trait: all.find((t) => t.id === hit.page.id)!, matches: hit.matches }))
      : all.map((trait) => ({ trait }));
    const first = new Set(chosen);
    return [...found.filter((i) => first.has(i.trait.id)), ...found.filter((i) => !first.has(i.trait.id))];
  });

  /** Where a trait sits, below the workspace. */
  function pathOf(id: string) {
    const page = local.page(id);
    return page ? local.ancestors(page).slice(1).map((p) => p.title || "Untitled").join(" / ") : "";
  }

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
      if (item) toggle(item.trait.id);
    }
  }

  const toggle = (id: string) => onchange(value.includes(id) ? value.filter((t) => t !== id) : [...value, id]);
</script>

<TextField bind:ref={input} class="mb-1 h-9 w-full" placeholder="Find a trait" bind:value={query} oninput={() => (active = 0)} onkeydown={onkey} />
<div class="contents" bind:this={list} data-testid="trait-picker">
  {#each items as { trait, matches }, index (trait.id)}
    {@const path = pathOf(trait.id)}
    <button class="menu-item" data-active={index === active ? "true" : undefined} onmouseenter={() => (active = index)} onclick={() => toggle(trait.id)}>
      <PageGlyph icon={trait.icon} kind="trait" />
      <span class="min-w-0 shrink truncate"><Highlighted text={trait.name} {matches} /></span>
      <span class="shrink-0 text-[12px] text-ink-30">{trait.pages}</span>
      <span class="min-w-0 flex-1 truncate text-right text-[12px] text-ink-30" title={path}>{path}</span>
      <span class="grid size-4 shrink-0 place-items-center">{#if value.includes(trait.id)}<Check size={16} />{/if}</span>
    </button>
  {:else}
    <p class="px-2.5 py-1.5 text-[13px] text-ink-30">No trait matches</p>
  {/each}
</div>
