<script lang="ts">
  import type { Snippet } from "svelte";
  import RelationPicker from "../properties/RelationPicker.svelte";
  import { Sortable } from "$lib/sortable.svelte";
  import { moveColumn, withTitle } from "./cells";
  import { FORMULA_TERMS } from "$model/formula/terms";
  import { formulaTypes } from "$model/formula/types";
  import { portal } from "$lib/portal";
  import { formulas } from "$lib/scripts/formula.svelte";
  import ScriptEditor from "../code/ScriptEditor.svelte";
  import { VIEW_ICONS } from "$lib/view-icon";
  import SelectMenu from "../ui/SelectMenu.svelte";
  import { Archive, ArchiveRestore, ArrowUpDown, Calendar, Check, Clock, ChevronRight, Code, FolderInput, GripVertical, Eye, Filter as FilterIcon, GanttChart, Group, Kanban, List, Plus, Settings2, Shapes, Table, Type, X } from "lucide-svelte";
  import { type Cleanup, CLEANUP_MAX_DAYS, CREATED, FILTER_OPS, type Filter, PARENT, TITLE, UNDER, UPDATED, VIEW_KINDS, type ViewKind } from "$model/views";
  import type { View } from "$lib/api";
  import { palette } from "$lib/stores/palette.svelte";
  import { people } from "$lib/stores/people.svelte";
  import { traits } from "$lib/stores/traits.svelte";
  import { viewRows } from "$lib/stores/view-rows.svelte";
  import { local } from "$lib/sync/local.svelte";
  import { addBoardGroup, addLinkedProperty, addTimelineDate, createLinkedTrait, updateView } from "$lib/views";
  import type { PropertyDefinition, PropertyType } from "$model/properties";
  import AddProperty from "./AddProperty.svelte";
  import Popover from "../ui/Popover.svelte";
  import PropertyIcon from "../properties/PropertyIcon.svelte";
  import TraitPicker from "./TraitPicker.svelte";
  import TextField from "../ui/TextField.svelte";

  /** A view's settings: which pages (traits, where), filters, sorts, grouping, layout, shown columns, where new pages go. */
  let { view, canEdit }: { view: View; canEdit: boolean } = $props();

  const ICON = VIEW_ICONS;
  const LAYOUT: Record<ViewKind, string> = { table: "Table", board: "Board", list: "List", timeline: "Timeline" };
  const columns = $derived(viewRows.get(view.id)?.columns ?? []);
  const fields = $derived([
    { id: TITLE, name: "Name" },
    ...columns.map((p) => ({ id: p.name, name: p.name })),
    { id: CREATED, name: "Created" },
    { id: UPDATED, name: "Edited" },
    { id: PARENT, name: "Parent" },
    { id: UNDER, name: "Inside" },
  ]);
  const place = (f: Filter) => f.property === PARENT || f.property === UNDER;
  const filters = $derived(view.filter.map((filter, index) => ({ filter, index })).filter(({ filter }) => !filter.property.startsWith("$trait")));
  const chosen = $derived(view.traits.flatMap((id) => traits.get(id) ?? []));
  const groupable = $derived(columns.filter((p) => (view.kind === "timeline" ? p.type === "date" : p.type === "select")));
  const onBars = $derived(view.barProperties ?? columns.map((p) => p.name));
  const visible = $derived(view.visibleProperties ?? columns.map((p) => p.name));
  const OP_LABEL: Record<Filter["op"], string> = { is: "is", is_not: "is not", contains: "contains", empty: "is empty", not_empty: "is not empty", gt: ">", lt: "<" };
  const button = "item item-normal item-hug";
  const select = "bg-ink-5 text-[13px]";
  const remove = "ml-auto grid size-7 shrink-0 place-items-center rounded-sm text-ink-30 hover:bg-ink-5 hover:text-hot";
  const titleOf = (id: unknown) => local.page(String(id))?.title || "Untitled";

  const save = (patch: Parameters<typeof updateView>[1]) => updateView(view, patch);
  /** Where new pages go: a page in the trash or gone is no place, so the view asks each time (`chosenParent`). */
  const parent = $derived(view.newParent ? local.page(view.newParent) : undefined);

  /** Properties dragged by their handle into a new order, in the trait that has them, so every view of it follows. */
  const sorting = new Sortable("y", (name, before) => {
    const result = viewRows.get(view.id);
    if (!result) return;
    const shownNames = columns.map((c) => c.name).filter((n) => visible.includes(n));
    // A hidden property is not where the title can stand: it goes before the next shown one instead.
    const rest = listed.slice(listed.indexOf(before ?? "") >= 0 ? listed.indexOf(before ?? "") : listed.length);
    const at = name === TITLE ? (rest.find((n) => shownNames.includes(n)) ?? null) : before;
    moveColumn(view, result, shownNames, name, at);
  });
  const ROW_PX = 36;
  /** Every property, the title among them where it stands. */
  const listed = $derived(withTitle(view, columns.map((c) => c.name)));
  const grab = (e: PointerEvent, name: string) => sorting.start(e, name, listed, listed.map(() => ROW_PX));

  let editingSort = $state(false);
  let sortCode = $state("");
  const firstRow = $derived(viewRows.get(view.id)?.rows[0]?.id);
  const saveSort = () => sortCode !== (view.sortCode ?? "") && save({ sortCode: sortCode.trim() ? sortCode : null });
  /** The expression's value on the view's first page, as it is typed. */
  async function evaluateSort() {
    if (!firstRow) return null;
    const { value, error } = await formulas.run(firstRow, sortCode);
    return { logs: [], result: value, ...(error && { error }) };
  }
  /** What a filter on a property may be compared with, picked rather than typed: a select's options, the members. */
  function valueChoices(property: string) {
    const column = columns.find((c) => c.name === property);
    if (column?.type === "select" || column?.type === "multi_select") return (column.options ?? []).map((o) => ({ value: o.name, label: o.name }));
    if (column?.type === "person") {
      // The members, and whoever the view's pages already name (assistants are people too, not members).
      const named = (viewRows.get(view.id)?.rows ?? []).flatMap((r) => (Array.isArray(r.properties[property]) ? (r.properties[property] as { id: string }[]) : []).map((a) => a.id));
      const ids = [...new Set([...people.members.flatMap((m) => (m.peopleId ? [m.peopleId] : [])), ...named])];
      return ids.map((id) => ({ value: id, label: people.name(id) ?? people.members.find((m) => m.peopleId === id)?.name ?? "Someone" }));
    }
    return null;
  }
  const setFilter = (index: number, patch: Partial<Filter>) => save({ filter: view.filter.map((f, i) => (i === index ? { ...f, ...patch } : f)) });

  /** A place filter's page, picked in the palette: the page right above them (Parent), or any above (Inside). */
  function pickPlace(index: number) {
    palette.pick(view.filter[index].property === PARENT ? "Parent is…" : "Inside of…", new Set([view.id]), (id) => {
      palette.hide();
      setFilter(index, { value: id });
    });
  }
  /** What a filter on a property may ask: a place is or (right under) is not a page. */
  const opsOf = (property: string): readonly Filter["op"][] => (property === UNDER ? ["is"] : property === PARENT ? ["is", "is_not"] : FILTER_OPS);

  let newName = $state("");
  /** A property for every trait the view shows, under the name typed, else the type's own. */
  function addLinked(type: PropertyType, extra: Partial<PropertyDefinition> = {}) {
    const name = newName.trim();
    addLinkedProperty(view, type, { ...extra, ...(name && { name }) });
    newName = "";
  }

  /** The cleanup rule being edited: the saved one until something is changed. */
  let draft = $state<Cleanup | null>(null);
  const DEFAULT_DAYS = 7;
  /** What a rule on a property starts with: a select's "Done" when it has one, else its first option. */
  const firstValue = (property: string) => {
    const choices = valueChoices(property) ?? [];
    return (choices.find((c) => /^done$/i.test(c.label)) ?? choices[0])?.value ?? "";
  };
  const firstProperty = $derived(columns.find((p) => p.type === "select")?.name ?? columns[0]?.name ?? "");
  const rule = $derived(draft ?? view.cleanup ?? { property: firstProperty, value: firstValue(firstProperty), days: DEFAULT_DAYS });
  const editRule = (patch: Partial<Cleanup>) => (draft = { ...rule, ...patch });
  const ruleLabel = (r: Cleanup | null) => (r ? `${r.property} is ${r.value || "empty"} for ${r.days} ${r.days === 1 ? "day" : "days"}` : "Off");
  function saveRule(close: () => void) {
    if (!rule.property) return;
    save({ cleanup: rule });
    draft = null;
    close();
  }

  function layout(kind: ViewKind) {
    const groupBy = kind === "board" ? (columns.find((p) => p.type === "select")?.name ?? null) : kind === "timeline" ? (columns.find((p) => p.type === "date")?.name ?? null) : view.groupBy;
    save({ kind, groupBy });
  }
</script>

{#if canEdit}
  {@const Layout = ICON[view.kind]}
  <div class="flex flex-wrap items-center gap-0.5" data-testid="view-toolbar">
    <Popover align="start" width="w-72">
      {#snippet trigger({ toggle })}
        <button class={button} aria-label="View settings" title="View settings" onclick={toggle}><Settings2 size={16} /></button>
      {/snippet}
      {#snippet children()}
        <!-- Each setting a row saying its value; a click opens what changes it. -->
        {@render setting("Source", Shapes, chosen.length ? chosen.map((t) => t.name).join(" + ") : "No traits", sourcePicker, "w-96")}
        <div class="my-1 border-t border-line" role="separator"></div>
        {@render setting("Properties", Eye, `${columns.filter((c) => visible.includes(c.name)).length} shown`, propertiesPicker, "w-72")}
        {#if view.kind === "board" || view.kind === "timeline"}
          {@render setting(view.kind === "board" ? "Group by" : "Dates", view.kind === "board" ? Group : Calendar, view.groupBy ?? "None", groupPicker, "w-56")}
        {/if}
        <div class="my-1 border-t border-line" role="separator"></div>
        {@render setting("New pages go", FolderInput, parent ? parent.title || "Untitled" : "Ask each time", parentPicker, "w-80")}
        <div class="my-1 border-t border-line" role="separator"></div>
        <button class="menu-item" aria-pressed={view.showArchived} onclick={() => save({ showArchived: !view.showArchived })}>
          <ArchiveRestore size={16} class="text-ink-45" /><span class="shrink-0">Show archived</span>
          <span class="ml-auto">{@render tick(view.showArchived)}</span>
        </button>
        {@render setting("Clean up", Archive, ruleLabel(view.cleanup), cleanupPicker, "w-96")}
      {/snippet}
    </Popover>

    <Popover align="start" width="w-80">
      {#snippet trigger({ toggle })}
        <button class="{button} {view.sort.length || view.sortCode?.trim() ? 'text-accent' : ''}" onclick={toggle}><ArrowUpDown size={16} /> Sort</button>
      {/snippet}
      {#snippet children({ close })}
        <div class="space-y-1 p-1">
          <p class="px-1.5 text-[12px] text-ink-45">Pages are ordered by what this returns for each, smallest first (an array sorts key by key); ties keep the order you drag them into.</p>
          {#if view.sortCode?.trim()}
            <pre class="max-h-24 overflow-hidden rounded-sm bg-[var(--code-bg)] px-2 py-1.5 font-mono text-[12px] whitespace-pre-wrap text-ink-70">{view.sortCode}</pre>
          {/if}
          <div class="flex gap-1">
            <button class="{button} flex-1" onclick={() => { close(); sortCode = view.sortCode ?? ""; editingSort = true; }}><Code size={16} /> {view.sortCode?.trim() ? "Edit expression" : "Sort by an expression"}</button>
            {#if view.sortCode?.trim()}<button class={remove} aria-label="Remove sorting" onclick={() => save({ sortCode: null })}><X size={16} /></button>{/if}
          </div>
          {#each view.sort as sort, index (index)}
            <div class="flex items-center gap-1 px-1.5 text-[13px] text-ink-70">
              <span class="min-w-0 flex-1 truncate">Then by {fields.find((f) => f.id === sort.property)?.name ?? sort.property}, {sort.direction === "asc" ? "ascending" : "descending"}</span>
              <button class={remove} aria-label="Remove sort" onclick={() => save({ sort: view.sort.filter((_, i) => i !== index) })}><X size={16} /></button>
            </div>
          {/each}
        </div>
      {/snippet}
    </Popover>

    <Popover align="start" width="w-96">
      {#snippet trigger({ toggle })}
        <button class="{button} {filters.length ? 'text-accent' : ''}" onclick={toggle}><FilterIcon size={16} /> Filter{filters.length ? ` · ${filters.length}` : ""}</button>
      {/snippet}
      {#snippet children()}
        <div class="space-y-1 p-1">
          {#each filters as { filter, index } (index)}
            <div class="flex items-center gap-1">
              <SelectMenu class={select} label="Property" value={filter.property} choices={fields.map((f) => ({ value: f.id, label: f.name }))} onpick={(property) => setFilter(index, place({ property, op: "is" }) ? { property, op: "is", value: "" } : { property })} />
              <SelectMenu class={select} label="Condition" value={filter.op} choices={opsOf(filter.property).map((op) => ({ value: op, label: OP_LABEL[op] }))} onpick={(op) => setFilter(index, { op })} />
              {#if place(filter)}
                <button class="h-7 min-w-0 flex-1 truncate rounded-sm bg-ink-5 px-1.5 text-left text-[13px] hover:bg-ink-10" onclick={() => pickPlace(index)}>{filter.value ? titleOf(filter.value) : "Pick a page…"}</button>
              {:else if filter.op !== "empty" && filter.op !== "not_empty" && valueChoices(filter.property)}
                <SelectMenu class="{select} min-w-0 flex-1" label="Value" value={String(filter.value ?? "")} choices={valueChoices(filter.property) ?? []} onpick={(value) => setFilter(index, { value })} />
              {:else if filter.op !== "empty" && filter.op !== "not_empty"}
                <TextField class="h-7 flex-1 px-1.5 text-[13px]" value={filter.value ?? ""} onchange={(e) => setFilter(index, { value: e.currentTarget.value })} />
              {/if}
              <button class={remove} aria-label="Remove filter" onclick={() => save({ filter: view.filter.filter((_, i) => i !== index) })}><X size={16} /></button>
            </div>
          {/each}
          <button class="{button} w-full" onclick={() => save({ filter: [...view.filter, { property: TITLE, op: "contains", value: "" }] })}><Plus size={16} /> Add a filter</button>
        </div>
      {/snippet}
    </Popover>

    <Popover align="start" width="w-44">
      {#snippet trigger({ toggle })}
        <button class={button} onclick={toggle}><Layout size={16} /> {LAYOUT[view.kind]}</button>
      {/snippet}
      {#snippet children({ close })}{@render layoutPicker(close)}{/snippet}
    </Popover>
  </div>
{/if}

{#if editingSort}
  <div use:portal>
    <ScriptEditor title="Sort {local.page(view.id)?.title || 'view'}" bind:code={sortCode} language="formula"
      placeholder={'What orders the pages, e.g. return [self.prop("Status").value, self.prop("Due").value?.start]'}
      declarations={formulaTypes(columns)} schema={columns} selects={[]} terms={FORMULA_TERMS}
      edited={sortCode !== (view.sortCode ?? "")} onrun={firstRow ? evaluateSort : undefined}
      onsave={saveSort} ondone={() => { saveSort(); editingSort = false; }} oncancel={() => (editingSort = false)} />
  </div>
{/if}

{#snippet tick(on: boolean)}
  <span class="grid size-4 place-items-center rounded-xs border {on ? 'border-accent bg-accent text-accent-ink' : 'border-ink-20'}">{#if on}<Check size={12} strokeWidth={3} />{/if}</span>
{/snippet}

{#snippet handle(name: string)}
  <span class="grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded-xs text-ink-30 opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-ink active:cursor-grabbing {sorting.dragging === name ? 'opacity-100' : ''}"
    role="button" tabindex="-1" aria-label="Drag to reorder" onpointerdown={(e) => grab(e, name)} onclick={(e) => e.stopPropagation()} onkeydown={() => {}}><GripVertical size={14} /></span>
{/snippet}

{#snippet titleRow()}
  <!-- The title is always shown; only where it stands among the properties changes. -->
  <div class="group/row flex h-9 items-center gap-2.5 rounded-md pr-2.5 pl-1 {sorting.dragging === TITLE ? 'bg-surface shadow-card' : ''}" role="listitem" style={sorting.style(TITLE)}>
    {@render handle(TITLE)}<Type size={16} class="shrink-0 text-ink-45" /><span class="min-w-0 flex-1 truncate">Name</span>
  </div>
{/snippet}

{#snippet setting(label: string, Icon: typeof Shapes, value: string, picker: Snippet<[() => void]>, width: string)}
  <Popover align="end" {width} block>
    {#snippet trigger({ toggle })}
      <button class="menu-item" onclick={toggle}>
        <Icon size={16} class="text-ink-45" /><span class="shrink-0">{label}</span>
        <span class="ml-auto min-w-0 truncate text-ink-45">{value}</span><ChevronRight size={14} class="text-ink-30" />
      </button>
    {/snippet}
    {#snippet children({ close })}{@render picker(close)}{/snippet}
  </Popover>
{/snippet}

{#snippet sourcePicker()}
  <TraitPicker value={view.traits} onchange={(ids) => save({ traits: ids })} />
  {#if !view.traits.length}
    <div class="my-1 border-t border-line" role="separator"></div>
    <button class="menu-item" onclick={() => void createLinkedTrait(view)}><Plus size={16} /> Create linked trait</button>
  {/if}
{/snippet}

{#snippet layoutPicker(close: () => void)}
  {#each VIEW_KINDS as kind (kind)}
    {@const Icon = ICON[kind]}
    <button class="menu-item" data-selected={view.kind === kind} onclick={() => { close(); layout(kind); }}><Icon size={16} /> {LAYOUT[kind]}</button>
  {/each}
{/snippet}

{#snippet groupPicker(close: () => void)}
  {#each groupable as p (p.name)}
    <button class="menu-item" data-selected={view.groupBy === p.name} onclick={() => { close(); save({ groupBy: p.name }); }}><PropertyIcon definition={p} /> {p.name}</button>
  {/each}
  {#if view.kind === "board"}
    <button class="menu-item" onclick={() => { close(); void addBoardGroup(view); }}><Plus size={16} /> Add select property</button>
  {/if}
  {#if view.kind === "timeline"}
    <button class="menu-item" onclick={() => { close(); void addTimelineDate(view); }}><Plus size={16} /> Add date property</button>
  {/if}
{/snippet}

{#snippet cleanupPicker(close: () => void)}
  <!-- "Archive pages in this view when [a property] is [a value] for [N] days": saved with the view, run daily and once now. -->
  <div class="space-y-2 p-1.5 text-[13px]" data-testid="cleanup-rule">
    <p class="px-0.5 text-[12px] text-ink-45">Archive pages in this view once a property has held a value for some days. Runs every day, and right away when saved.</p>
    <div class="flex items-center gap-1">
      <span class="w-10 shrink-0 text-ink-45">When</span>
      <SelectMenu class="{select} min-w-0 flex-1" label="Property" value={rule.property} choices={columns.map((p) => ({ value: p.name, label: p.name }))} onpick={(property) => editRule({ property, value: firstValue(property) })} />
      <span class="shrink-0 text-ink-45">is</span>
      {#if valueChoices(rule.property)}
        <SelectMenu class="{select} min-w-0 flex-1" label="Value" value={rule.value} choices={valueChoices(rule.property) ?? []} onpick={(value) => editRule({ value })} />
      {:else}
        <TextField class="h-8 min-w-0 flex-1 px-1.5 text-[13px]" aria-label="Value" value={rule.value} oninput={(e) => editRule({ value: e.currentTarget.value })} />
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <span class="w-10 shrink-0 text-ink-45">for</span>
      <TextField class="h-8 w-20 px-1.5 text-[13px]" type="number" min="0" max={CLEANUP_MAX_DAYS} aria-label="Days" value={String(rule.days)}
        oninput={(e) => { const days = Math.round(Number(e.currentTarget.value)); if (Number.isFinite(days) && days >= 0 && days <= CLEANUP_MAX_DAYS) editRule({ days }); }} />
      <span class="text-ink-45">days</span>
    </div>
    <div class="flex items-center gap-1 pt-1">
      <button class="{button} flex-1" disabled={!rule.property} onclick={() => saveRule(close)}><Check size={16} /> {view.cleanup ? "Save rule" : "Turn on"}</button>
      {#if view.cleanup}
        <button class="{button} hover:text-hot" onclick={() => { draft = null; save({ cleanup: null }); close(); }}><X size={16} /> Turn off</button>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet parentPicker(close: () => void)}
  <!-- As a relation's page is picked: a field, the pages, the chosen one checked (unchecking it means asking each time). -->
  <RelationPicker value={view.newParent ? [view.newParent] : []} onpick={(ids) => { close(); save({ newParent: ids.find((id) => id !== view.newParent) ?? null }); }} />
{/snippet}

{#snippet propertiesPicker()}
{#if view.kind === "timeline"}
  <!-- A timeline shows properties in two places: its table, and beside its bars. -->
  <div class="flex items-center pt-1 pr-2.5 pb-1.5 pl-7.5 text-[12px] font-medium text-ink-45">
    <span class="flex-1">Properties</span><span class="w-10 text-center">Table</span><span class="w-10 text-center">Bar</span>
  </div>
  {#each listed as name (name)}
    {@const p = columns.find((c) => c.name === name)}
    {#if !p}{@render titleRow()}{:else}
    {@const inTable = visible.includes(p.name)}
    {@const onBar = onBars.includes(p.name)}
    <div class="group/row flex h-9 items-center gap-2.5 rounded-md pr-2.5 pl-1 {sorting.dragging === p.name ? 'bg-surface shadow-card' : ''}" role="listitem" style={sorting.style(p.name)}>
      {@render handle(p.name)}<PropertyIcon definition={p} /><span class="min-w-0 flex-1 truncate">{p.name}</span>
      <span class="flex"><button class="grid h-7 w-10 place-items-center rounded-sm hover:bg-ink-5" aria-label="{p.name} in the table" aria-pressed={inTable}
        onclick={() => save({ visibleProperties: inTable ? visible.filter((name) => name !== p.name) : [...visible, p.name] })}>{@render tick(inTable)}</button
      ><button class="grid h-7 w-10 place-items-center rounded-sm hover:bg-ink-5" aria-label="{p.name} on the bars" aria-pressed={onBar}
        onclick={() => save({ barProperties: onBar ? onBars.filter((name) => name !== p.name) : [...onBars, p.name] })}>{@render tick(onBar)}</button></span>
    </div>
    {/if}
  {/each}
{:else}
  <p class="pt-1 pr-2.5 pb-1.5 pl-7.5 text-[12px] font-medium text-ink-45">Shown properties</p>
  {#each listed as name (name)}
    {@const p = columns.find((c) => c.name === name)}
    {#if !p}{@render titleRow()}{:else}
    {@const shown = visible.includes(p.name)}
    <button class="group/row menu-item pl-1 {sorting.dragging === p.name ? 'bg-surface shadow-card' : ''}" style={sorting.style(p.name)} onclick={() => save({ visibleProperties: shown ? visible.filter((name) => name !== p.name) : [...visible, p.name] })}>
      {@render handle(p.name)}<PropertyIcon definition={p} /><span class="min-w-0 flex-1 truncate">{p.name}</span>
      <span class="grid size-4 shrink-0 place-items-center">{#if shown}<Check size={16} />{/if}</span>
    </button>
    {/if}
  {/each}
  {#if view.kind === "table"}
    {@const shown = visible.includes(UPDATED)}
    <button class="menu-item pl-6" onclick={() => save({ visibleProperties: shown ? visible.filter((name) => name !== UPDATED) : [...visible, UPDATED] })}>
      <Clock size={16} class="text-ink-45" /><span class="min-w-0 flex-1 truncate">Edited</span>
      <span class="grid size-4 shrink-0 place-items-center">{#if shown}<Check size={16} />{/if}</span>
    </button>
  {/if}
{/if}
{#if view.traits.length}
  <!-- Named first: the property goes to every trait at once, and a rename afterwards would reach only one. -->
  <div class="my-1 border-t border-line" role="separator"></div>
  <div class="flex items-center gap-1">
    <TextField class="h-8 min-w-0 flex-1" placeholder="New property" aria-label="New property name" bind:value={newName} onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLinked("text"); } }} />
    <AddProperty onpick={addLinked} />
  </div>
{/if}
{/snippet}
