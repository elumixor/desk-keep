<script lang="ts">
  import { TITLE, UPDATED } from "$model/views";
  import { brief } from "$lib/time";
  import SortHeader from "./SortHeader.svelte";
  import { Sortable } from "$lib/sortable.svelte";
  import { Clock, PanelRightOpen, Plus, Type } from "lucide-svelte";
  import { flip } from "svelte/animate";
  import type { PropertyDefinition, PropertyType, PropertyValue as Value } from "$model/properties";
  import type { View, ViewResult } from "$lib/api";
  import { addOption, moveProperty, newDefinition } from "$lib/schema";
  import { pageEntries } from "$lib/page-menu";
  import { menu } from "$lib/stores/context-menu.svelte";
  import { newProperty } from "$lib/stores/new-property.svelte";
  import { pages } from "$lib/stores/pages.svelte";
  import { addViewProperty, updateView } from "$lib/views";
  import PropertyValue from "../properties/PropertyValue.svelte";
  import AddProperty from "./AddProperty.svelte";
  import { cellOf, columnTarget, moveColumn, shownColumns, withTitle } from "./cells";
  import { batches } from "./batches.svelte";
  import { followRows } from "./follow-rows";
  import PropertyHeader from "./PropertyHeader.svelte";
  import { columnWidths } from "./widths.svelte";
  import RowIcon from "./RowIcon.svelte";
  import { RowDrag } from "./row-drag.svelte";
  import { type Place, placeEntries, subtasks } from "./subtasks.svelte";
  import TextField from "../ui/TextField.svelte";

  let {
    view,
    result,
    canEdit,
    onopen,
    onadd,
    onplace,
    fill = false,
  }: {
    view: View;
    result: ViewResult;
    canEdit: boolean;
    onopen: (id: string) => void;
    onadd: () => void;
    onplace: Place;
    /** Fills its parent's height (a flex column). */
    fill?: boolean;
  } = $props();

  const widths = columnWidths(() => `keep.widths.${view.id}`);
  const columns = $derived(shownColumns(view, result));
  /** The rows with their subtasks under them, as far as they are open. */
  const tree = $derived(subtasks.nest(view.id, result.rows));
  const batch = batches(() => tree.rows.length);
  const rows = $derived(tree.rows.slice(0, batch.limit));
  /** Rows dragged by their title to another place among their siblings, or under another row. */
  const rowDrag = new RowDrag(() => view.id);
  /** Columns dragged by their handle into a new order, in the trait that has them. */
  const sorting = new Sortable("x", (name, before) => moveColumn(view, result, columns.map((c) => c.name), name, before));
  /** The columns as they stand, the title among them. */
  const order = $derived(withTitle(view, columns.map((c) => c.name)));
  /** The first column's room, so the icon in it (6px into its cell) stands under the page title. */
  const INSET = "width: max(0px, var(--view-gutter, 0px) - 6px)";
  const TITLE_WIDTH = 288;
  const widthOf = (name: string) => widths.of(name, name === TITLE ? TITLE_WIDTH : undefined);
  const grab = (e: PointerEvent, name: string) => canEdit && sorting.start(e, name, order, order.map(widthOf), 4);

  /** When each page was last edited, as a column of its own: shown when the view lists `$updated`. */
  const edited = $derived(view.visibleProperties?.includes(UPDATED) ?? false);
  const sortedBy = (property: string) => (view.sort[0]?.property === property ? view.sort[0].direction : null);
  /** A header orders the view by its column first, or stops ordering by it. */
  const sortBy = (property: string) => (direction: "asc" | "desc" | null) =>
    void updateView(view, { sort: [...(direction ? [{ property, direction }] : []), ...view.sort.filter((s) => s.property !== property)] });

  function hide(name: string) {
    void updateView(view, { visibleProperties: columns.map((c) => c.name).filter((c) => c !== name) });
  }

  async function addColumn(type: PropertyType, extra?: Partial<PropertyDefinition>) {
    const definition = newDefinition(result.columns, type, extra);
    await addViewProperty(view, definition);
    newProperty.mark(definition.name);
    if (view.visibleProperties) void updateView(view, { visibleProperties: [...view.visibleProperties, definition.name] });
  }
</script>

<div class="overflow-x-auto {fill ? 'min-h-0 flex-1' : ''} {rowDrag.held ? 'cursor-grabbing select-none' : ''}">
  <table class="w-max min-w-full border-collapse {fill ? 'h-full' : ''} text-[14px]" data-testid="table-view">
    <thead>
      <tr class="border-b border-line text-[13px]">
        <th class="p-0 [border-bottom-style:hidden]" style={INSET}></th>
        {#each order as name (name)}
          {@const column = columns.find((c) => c.name === name)}
          {@const target = column ? columnTarget(result, name) : null}
          <th
            class="group/col relative border-r border-line/30 p-0 text-left font-normal text-ink-45 {sorting.dragging === name ? 'bg-page shadow-card' : ''}"
            style="width: {widthOf(name)}px; min-width: {widthOf(name)}px; {sorting.style(name)}"
            onpointerdown={(e) => (column ? target : true) && grab(e, name)}
          >
            {#if column}
              <PropertyHeader {target} definition={column} editable={canEdit && !!target} onhide={() => hide(name)} sorted={sortedBy(name)} onsort={canEdit ? sortBy(name) : undefined} />
            {:else}
              <SortHeader label="Name" icon={Type} sorted={sortedBy(TITLE)} onsort={canEdit ? sortBy(TITLE) : undefined} />
            {/if}
            <span
              class="absolute inset-y-1 -right-[3px] z-10 w-[5px] cursor-col-resize rounded-full transition-colors hover:bg-accent/50"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize column"
              onpointerdown={(e) => widths.resize(e, name, name === TITLE ? TITLE_WIDTH : undefined)}
            ></span>
          </th>
        {/each}
        {#if edited}
          <th class="border-r border-line/30 p-0 text-left font-normal text-ink-45" style="width: 120px; min-width: 120px">
            <SortHeader label="Edited" icon={Clock} sorted={sortedBy(UPDATED)} onsort={canEdit ? sortBy(UPDATED) : undefined} />
          </th>
        {/if}
        {#if canEdit && view.traits.length}<th class="p-0 text-left"><AddProperty align="start" onpick={(type, extra) => void addColumn(type, extra)} /></th>{:else}<th></th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each rows as { row, depth, children } (row.id)}
        <tr class="group animate-appear border-b border-line/30 transition-colors hover:bg-ink-5 {rowDrag.mark(row.id)}" data-row={row.id}
          animate:flip={{ duration: 200 }}
          use:menu={() => pageEntries(row.id, { peek: () => onopen(row.id), more: canEdit ? placeEntries((where) => onplace(row.id, where)) : [] })}>
          <td class="bg-page p-0 [border-bottom-style:hidden]"></td>
          {#each order as name (name)}
            {@const column = columns.find((c) => c.name === name)}
            {#if !column}
            <td class="border-r border-line/30 px-1 {sorting.dragging === name ? 'bg-page shadow-card' : ''}" style={sorting.style(name)}>
              <!-- The whole title is the row's handle: a click edits it, a drag moves the row. -->
              <div class="flex h-8 items-center gap-1" role="presentation" onpointerdown={(e) => canEdit && rowDrag.start(e, row.id)}>
                <RowIcon viewId={view.id} id={row.id} icon={row.icon} {depth} {children} editable={canEdit} />
                <TextField variant="ghost"
                  class="flex-1 rounded-xs px-1 font-medium"
                  value={row.title}
                  placeholder="Untitled"
                  readonly={!canEdit}
                  onchange={(e) => pages.edit(row.id, { title: e.currentTarget.value })}
                />
                <button
                  class="flex h-6 shrink-0 items-center gap-1 rounded-xs bg-surface px-1.5 text-[12px] font-medium text-ink-45 opacity-0 shadow-panel transition group-hover:opacity-100 hover:text-ink focus:opacity-100 max-md:opacity-100"
                  aria-label="Open"
                  onclick={() => onopen(row.id)}
                >
                  <PanelRightOpen size={14} /> Open
                </button>
              </div>
            </td>
            {:else}
              {@const cell = cellOf(row, column)}
              {@const target = columnTarget(result, column.name)}
              <td class="border-r border-line/30 px-1 {sorting.dragging === name ? 'bg-page shadow-card' : ''}" data-column={column.name} style={sorting.style(name)}>
                  <PropertyValue
                  definition={cell.definition}
                  value={cell.value as Value | undefined}
                  editable={canEdit}
                  pageId={cell.own ? row.id : undefined}
                  onchange={(value) => pages.setProperty(row.id, cell.definition.name, value, cell.own ? undefined : column)}
                  onadd={(name) => (target ? addOption(target, column.name, name) : "")}
                />
              </td>
            {/if}
          {/each}
          {#if edited}<td class="border-r border-line/30 px-2.5 text-[13px] whitespace-nowrap text-ink-45" title={row.updatedAt}>{row.updatedAt ? brief(row.updatedAt) : ""}</td>{/if}
          <td></td>
        </tr>
      {/each}
      {#if canEdit && !batch.more}
        <!-- "New" is the last row, under the pages. -->
        <tr class="animate-appear" use:followRows={rows.length}>
          <td class="p-0" colspan={order.length + (edited ? 3 : 2)}>
            <button class="flex h-8 w-full items-center gap-2 pr-2 pl-[var(--view-gutter,8px)] text-left text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink" onclick={onadd}><Plus size={16} /> New</button>
          </td>
        </tr>
      {/if}
      {#if fill}
        <!-- Takes the height left over; the column lines run to the bottom under pages, and there are none without them. -->
        <tr aria-hidden="true" class="h-full">
          <td></td>
          {#each order as name (name)}<td class={rows.length ? "border-r border-line/30" : ""}></td>{/each}
          {#if edited}<td class={rows.length ? "border-r border-line/30" : ""}></td>{/if}
          <td></td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>
{#if batch.more}<div use:batch.sentinel class="h-px"></div>{/if}

