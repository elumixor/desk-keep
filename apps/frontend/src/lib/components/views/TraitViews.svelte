<script lang="ts">
  import { Plus } from "lucide-svelte";
  import type { PageRecord } from "$model/sync";
  import { VIEW_KINDS, type ViewKind } from "$model/views";
  import { viewIcon, VIEW_ICONS } from "$lib/view-icon";
  import { local } from "$lib/sync/local.svelte";
  import { createView } from "$lib/views";
  import Popover from "../ui/Popover.svelte";
  import ViewBody from "./ViewBody.svelte";
  import ViewToolbar from "./ViewToolbar.svelte";

  /**
   * A trait's own views (the ones right under it showing it alone), as tabs over the pages having it: the first is
   * what the trait opens on; each keeps its own layout, filters and sorts.
   */
  let { traitId, views, canEdit }: { traitId: string; views: readonly PageRecord[]; canEdit: boolean } = $props();

  const KEY = $derived(`keep.trait-view.${traitId}`);
  let picked = $state<string | null>(null);
  $effect(() => {
    picked = sessionStorage.getItem(KEY);
  });
  const current = $derived(views.find((v) => v.id === picked) ?? views[0]);
  const query = $derived(current ? local.view(current.id) : undefined);
  const LABEL: Record<ViewKind, string> = { table: "Table", board: "Board", list: "List", timeline: "Timeline" };

  function pick(id: string) {
    picked = id;
    sessionStorage.setItem(KEY, id);
  }

  async function add(kind: ViewKind) {
    const groupBy = kind === "board" ? (local.trait(traitId)?.properties.find((p) => p.type === "select")?.name ?? null) : null;
    const view = await createView(traitId, kind, { traits: [traitId], groupBy, open: false });
    pick(view.id);
  }
</script>

<div class="flex flex-wrap items-center gap-0.5 border-b border-line pb-1" role="tablist" data-testid="trait-views">
  {#each views as view (view.id)}
    {@const Icon = viewIcon(view.id)}
    {@const here = view.id === current?.id}
    <button class="item item-normal item-hug {here ? 'text-ink' : 'text-ink-45'} relative" role="tab" aria-selected={here} onclick={() => pick(view.id)}>
      <Icon size={16} />{view.title || "Untitled"}
      {#if here}<span class="absolute inset-x-1.5 -bottom-[5px] h-0.5 rounded-full bg-ink"></span>{/if}
    </button>
  {/each}
  {#if canEdit}
    <Popover align="start" width="w-44">
      {#snippet trigger({ toggle })}
        <button class="item item-normal item-hug text-ink-45" aria-label="Add a view" title="Add a view" onclick={toggle}><Plus size={16} /></button>
      {/snippet}
      {#snippet children({ close })}
        <div class="p-1">
          {#each VIEW_KINDS as kind (kind)}
            {@const Icon = VIEW_ICONS[kind]}
            <button class="menu-item" onclick={() => { close(); void add(kind); }}><Icon size={16} class="text-ink-45" />{LABEL[kind]}</button>
          {/each}
        </div>
      {/snippet}
    </Popover>
  {/if}
  {#if query}<span class="ml-auto"><ViewToolbar view={query} {canEdit} /></span>{/if}
</div>
{#if query}
  {#key query.id}<div class="view-full pt-2"><ViewBody view={query} {canEdit} /></div>{/key}
{/if}
