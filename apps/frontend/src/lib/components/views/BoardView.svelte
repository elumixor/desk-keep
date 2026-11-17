<script lang="ts">
  import { Plus } from "lucide-svelte";
  import type { View, ViewResult } from "$lib/api";
  import { pages } from "$lib/stores/pages.svelte";
  import { addBoardGroup } from "$lib/views";
  import { columnStyle, TAG, tagStyle } from "$lib/tags";
  import { shownColumns } from "./cells";
  import RowCard from "./RowCard.svelte";
  import { batches } from "./batches.svelte";
  import Item from "../ui/Item.svelte";

  let {
    view,
    result,
    canEdit,
    onopen,
    onadd,
  }: { view: View; result: ViewResult; canEdit: boolean; onopen: (id: string) => void; onadd: (properties?: Record<string, unknown>) => void } = $props();

  const NONE = "__none";
  const rows = $derived(result.rows);
  const batch = batches(() => Math.max(0, ...columns.map((c) => inColumn(c.id).length)), 12, 24);
  const group = $derived(result.columns.find((p) => p.name === view.groupBy && p.type === "select") ?? result.columns.find((p) => p.type === "select"));
  const shown = $derived(shownColumns(view, result).filter((c) => c.name !== group?.name));
  /** A card's column is its option's name: pages that are not one trait's may have options of their own. */
  const optionName = (row: (typeof rows)[number]) => {
    const own = row.schema.find((p) => p.name === group?.name);
    const id = row.properties[group?.name ?? ""];
    return (own?.options ?? group?.options ?? []).find((o) => o.id === id)?.name.toLowerCase() ?? null;
  };
  const columns = $derived([
    ...(group?.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color ?? null })),
    { id: NONE, name: `No ${group?.name.toLowerCase() ?? "group"}`, color: null },
  ]);
  const inColumn = (id: string) => {
    const names = (group?.options ?? []).map((o) => o.name.toLowerCase());
    const name = columns.find((c) => c.id === id)?.name.toLowerCase();
    return rows.filter((r) => {
      const own = optionName(r);
      return id === NONE ? !own || !names.includes(own) : own === name;
    });
  };

  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);

  function drop(columnId: string) {
    const option = columns.find((c) => c.id === columnId);
    // Written by the option's name, which the page's own options of that name answer to.
    if (dragging && group) pages.setProperty(dragging, group.name, columnId === NONE ? null : (option?.name ?? null));
    dragging = null;
    over = null;
  }
</script>

{#if !group}
  <div class="flex flex-col items-center gap-2 py-10 text-ink-45">
    <p>A board groups pages by a select property.</p>
    {#if canEdit}<button class="item item-normal item-hug text-ink" onclick={() => void addBoardGroup(view)}><Plus size={16} /> Add select property</button>{/if}
  </div>
{:else}
  <div class="flex items-start gap-3 overflow-x-auto pt-2 pb-4" data-testid="board-view">
    {#each columns.filter((c) => c.id !== NONE || inColumn(NONE).length > 0 || dragging) as column (column.id)}
      <section
        class="flex w-64 shrink-0 flex-col gap-2 rounded-lg p-2 transition-shadow {over === column.id ? 'ring-2 ring-accent/50' : ''}"
        style={columnStyle(column.color)}
        aria-label={column.name}
        data-column={column.name}
        ondragover={(e) => {
          if (!dragging) return;
          e.preventDefault();
          over = column.id;
        }}
        ondragleave={() => (over = null)}
        ondrop={() => drop(column.id)}
      >
        <header class="flex h-6 items-center gap-2 px-1 text-[14px]">
          <span class={TAG} style={tagStyle(column.color)}>{column.name}</span>
          <span class="text-[13px] text-ink-45">{inColumn(column.id).length}</span>
        </header>
        {#each inColumn(column.id).slice(0, batch.limit) as row (row.id)}
          <div draggable={canEdit} ondragstart={() => (dragging = row.id)} ondragend={() => (dragging = null)} role="listitem" class="animate-appear {dragging === row.id ? 'opacity-40' : ''}">
            <RowCard {row} {shown} onopen={() => onopen(row.id)} />
          </div>
        {/each}
        {#if canEdit}
          <Item onclick={() => onadd(column.id === NONE ? {} : { [group.name]: column.name })}>
            <Plus size={16} /> New
          </Item>
        {/if}
      </section>
    {/each}
  </div>
  {#if batch.more}<div use:batch.sentinel class="h-px"></div>{/if}
{/if}
