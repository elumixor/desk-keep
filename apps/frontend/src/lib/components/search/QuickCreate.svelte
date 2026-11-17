<script lang="ts">
  import { FileText, Search, Shapes, Table2 } from "lucide-svelte";
  import { fade, scale } from "svelte/transition";
  import { page } from "$app/state";
  import { createPage } from "$lib/actions";
  import { menuKey } from "$lib/menu-key";
  import { access } from "$lib/stores/access.svelte";
  import { quickCreate } from "$lib/stores/quick-create";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { local } from "$lib/sync/local.svelte";
  import type { NodeKind } from "$model/nodes";
  import { pageItem, pagesByName } from "../editor/page-search.svelte";
  import Highlighted from "../ui/Highlighted.svelte";
  import KindPill from "../ui/KindPill.svelte";
  import PageGlyph from "../ui/PageGlyph.svelte";
  import TextField from "../ui/TextField.svelte";

  /** ⌘N: what to make (⌃H ⌃L or ← →) and under which page (typed, then ⌃J ⌃K or ↑ ↓), the open page unless told otherwise. */
  const KINDS = [
    { kind: "page", icon: FileText },
    { kind: "view", icon: Table2 },
    { kind: "trait", icon: Shapes },
  ] as const satisfies readonly { kind: NodeKind; icon: unknown }[];

  let kindAt = $state(0);
  let query = $state("");
  let selected = $state(0);
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();

  const kind = $derived(KINDS[kindAt].kind);
  const openPage = $derived(page.params.page ?? workspace.id);

  /** The open page and the workspace's top level first until something is typed, then whatever matches. */
  const places = $derived.by(() => {
    const first = query.trim()
      ? []
      : [...new Set([openPage, workspace.id])].flatMap((id) => {
          const record = id ? local.page(id) : undefined;
          return record ? [pageItem(record)] : [];
        });
    const firstIds = new Set(first.map((p) => p.id));
    return [...first, ...pagesByName(query).filter((p) => !firstIds.has(p.id))].filter((p) => access.can(p.id, "write"));
  });

  $effect(() => {
    if (!quickCreate.open) return;
    kindAt = 0;
    query = "";
    queueMicrotask(() => input?.focus());
  });

  $effect(() => {
    void query;
    selected = 0;
  });

  $effect(() => {
    list?.children[selected]?.scrollIntoView({ block: "nearest" });
  });

  function create(parentId: string | undefined) {
    if (!parentId) return;
    const made = kind;
    quickCreate.hide();
    void createPage(parentId, { kind: made });
  }

  function onKey(event: KeyboardEvent) {
    const key = menuKey(event);
    if (key === "ArrowRight") kindAt = (kindAt + 1) % KINDS.length;
    else if (key === "ArrowLeft") kindAt = (kindAt + KINDS.length - 1) % KINDS.length;
    else if (key === "ArrowDown") selected = Math.min(places.length - 1, selected + 1);
    else if (key === "ArrowUp") selected = Math.max(0, selected - 1);
    else if (key === "Enter" && !event.isComposing) create(places[selected]?.id);
    else if (key === "Escape") quickCreate.hide();
    else return;
    event.preventDefault();
  }
</script>

{#if quickCreate.open}
  <div class="fixed inset-0 z-50 bg-[var(--backdrop)] px-4" role="presentation" transition:fade={{ duration: 100 }} onmousedown={(e) => e.target === e.currentTarget && quickCreate.hide()}>
    <div class="mx-auto mt-[15vh] flex max-h-[60vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-float" role="dialog" aria-label="Create" transition:scale={{ start: 0.97, duration: 120 }}>
      <div class="flex gap-1 px-2 pt-2" role="radiogroup" aria-label="What to create">
        {#each KINDS as option, index (option.kind)}
          <button role="radio" aria-checked={index === kindAt} class="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg capitalize {index === kindAt ? 'bg-ink-10 font-medium' : 'text-ink-45 hover:bg-ink-5'}" onclick={() => { kindAt = index; input?.focus(); }}>
            <option.icon size={16} /> {option.kind}
          </button>
        {/each}
      </div>
      <div class="flex items-center gap-3 px-4">
        <Search size={16} class="text-ink-45" />
        <TextField variant="bare" bind:ref={input} bind:value={query} onkeydown={onKey} class="h-11 flex-1" placeholder="New {kind} under…" />
      </div>
      <ul bind:this={list} class="min-h-0 flex-1 overflow-y-auto px-2" role="listbox" aria-label="Under which page">
        {#each places as place, index (place.id)}
          <li role="option" aria-selected={index === selected}>
            <button class="menu-item" data-active={index === selected} onmouseenter={() => (selected = index)} onclick={() => create(place.id)}>
              <PageGlyph icon={place.icon} kind={place.kind} id={place.id} />
              <span class="min-w-0 truncate"><Highlighted text={place.label} matches={place.matches} /></span><KindPill kind={place.kind} id={place.id} />
              {#if place.hint}<span class="min-w-0 truncate text-[13px] text-ink-30">— {place.hint}</span>{/if}
              {#if place.id === openPage}<span class="ml-auto shrink-0 text-[12px] text-ink-30">open</span>{/if}
            </button>
          </li>
        {:else}
          <li class="px-3 py-8 text-center text-ink-30">No page to put it under.</li>
        {/each}
      </ul>
      <p class="px-4 py-2 text-[12px] text-ink-30">⌃H ⌃L what · ⌃J ⌃K where · ↵ create</p>
    </div>
  </div>
{/if}
