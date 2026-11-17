<script lang="ts">
  import { Plus } from "lucide-svelte";
  import { flip } from "svelte/animate";
  import type { PropertyValue as Value } from "$model/properties";
  import type { View, ViewResult } from "$lib/api";
  import PropertyValue from "../properties/PropertyValue.svelte";
  import { blank, cellOf, columnTarget } from "./cells";
  import { batches } from "./batches.svelte";
  import { followRows } from "./follow-rows";
  import { addOption } from "$lib/schema";
  import { pages } from "$lib/stores/pages.svelte";
  import TextField from "../ui/TextField.svelte";
  import Item from "../ui/Item.svelte";
  import { pageEntries } from "$lib/page-menu";
  import { menu } from "$lib/stores/context-menu.svelte";
  import RowIcon from "./RowIcon.svelte";
  import { type Place, placeEntries, subtasks } from "./subtasks.svelte";

  let {
    view,
    result,
    canEdit,
    onopen,
    onadd,
    onplace,
  }: { view: View; result: ViewResult; canEdit: boolean; onopen: (id: string) => void; onadd: () => void; onplace: Place } = $props();
  const tree = $derived(subtasks.nest(view.id, result.rows));
  const batch = batches(() => tree.rows.length);
</script>

<div class="list-aligned">
<ul class="-ml-2.5 list-none p-0 pt-1" data-testid="list-view">
  {#each tree.rows.slice(0, batch.limit) as { row, depth, children } (row.id)}
    <li class="group relative animate-appear" animate:flip={{ duration: 200 }}>
      <!-- The icon (with its children's chevron) sits over the row: no buttons inside its button. -->
      <!-- The row's empty room opens it; its title and values edit in place. -->
      <div class="flex min-h-8 w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-0.5 transition-colors hover:bg-ink-5" role="presentation"
        onclick={(e) => e.target === e.currentTarget && onopen(row.id)}
        use:menu={() => pageEntries(row.id, { peek: () => onopen(row.id), more: canEdit ? placeEntries((where) => onplace(row.id, where)) : [] })}>
        <span class="shrink-0" style="width: {depth * 20 + 20}px"></span>
        <TextField variant="ghost" class="-ml-1.5 field-sizing-content max-w-[28rem] min-w-[5.5rem] shrink rounded-xs px-1 font-medium" value={row.title} placeholder="Untitled" readonly={!canEdit}
          onchange={(e) => pages.edit(row.id, { title: e.currentTarget.value })} />
        {#each result.columns as column (column.name)}
          {@const cell = cellOf(row, column)}
          {@const target = columnTarget(result, column.name)}
          {#if canEdit || !blank(cell.value)}
            <span class="max-w-48 shrink-0 truncate text-[12px]">
              <PropertyValue definition={cell.definition} value={cell.value as Value | undefined} editable={canEdit} pageId={cell.own ? row.id : undefined}
                onchange={(value) => pages.setProperty(row.id, cell.definition.name, value, cell.own ? undefined : column)}
                onadd={(name) => (target ? addOption(target, column.name, name) : "")} />
            </span>
          {/if}
        {/each}
      </div>
      <span class="pointer-events-none absolute inset-y-0 left-2 flex items-center [&_button]:pointer-events-auto"><RowIcon viewId={view.id} id={row.id} icon={row.icon} {depth} {children} editable={canEdit} /></span>
    </li>
  {/each}
</ul>
{#if batch.more}<div use:batch.sentinel class="h-px"></div>{/if}
{#if canEdit}
  <div class="relative animate-appear" use:followRows={Math.min(tree.rows.length, batch.limit)}><Item width="fixed" onclick={onadd}><Plus size={16} /> New</Item></div>
{/if}
</div>
