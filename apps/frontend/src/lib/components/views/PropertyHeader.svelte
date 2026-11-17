<script lang="ts">
  import SelectMenu from "../ui/SelectMenu.svelte";
  import { DATE_FORMATS, NUMBER_FORMATS } from "$model/properties";
  import { DATE_FORMAT_LABELS, NUMBER_FORMAT_LABELS } from "$lib/time";
  import { ArrowDown, ArrowUp, CalendarDays, Code, EyeOff, Hash, Shapes, Trash2 } from "lucide-svelte";
  import type { PropertyDefinition } from "$model/properties";
  import { typeLabel } from "$lib/property-types";
  import { removeProperty, type SchemaTarget, updateProperty } from "$lib/schema";
  import { codeEditor } from "$lib/stores/code-editor.svelte";
  import { newProperty } from "$lib/stores/new-property.svelte";
  import TraitsMenu from "../properties/TraitsMenu.svelte";
  import OptionsEditor from "../properties/OptionsEditor.svelte";
  import PropertyIcon from "../properties/PropertyIcon.svelte";
  import TypePicker from "../properties/TypePicker.svelte";
  import EmojiPicker from "../ui/EmojiPicker.svelte";
  import Popover from "../ui/Popover.svelte";
  import Item from "../ui/Item.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * A property's name, opening its settings: a page's property, or a trait's (which every page following it shares);
   * without a `target` (a view's column no trait brings) only hiding it is offered. `edge`: as Item's.
   */
  let {
    target,
    definition,
    editable,
    onhide,
    marker,
    edge = false,
    sorted = null,
    onsort,
  }: {
    target: SchemaTarget | null;
    definition: PropertyDefinition;
    editable: boolean;
    onhide?: () => void;
    marker?: string;
    edge?: boolean;
    /** How the view is ordered by it, first: a table header shows it and orders by it. */
    sorted?: "asc" | "desc" | null;
    onsort?: (direction: "asc" | "desc" | null) => void;
  } = $props();
  let open = $state(false);
  const field = "w-full rounded-md bg-ink-5 px-2.5 caret-accent outline-none transition-colors hover:bg-ink-10 focus:bg-ink-10";
  let choosingIcon = $state(false);
  let nameField = $state<HTMLInputElement>();
  $effect(() => {
    if (!open) choosingIcon = false;
  });
  // A property just added opens here with its name selected, to be typed over (once the field is there).
  let naming = false;
  $effect(() => {
    if (target && editable && newProperty.take(definition.name)) open = naming = true;
  });
  $effect(() => {
    const field = nameField;
    if (!naming || !field) return;
    naming = false;
    requestAnimationFrame(() => {
      field.focus();
      field.select();
    });
  });
</script>

<Popover bind:open width="w-72" block>
  {#snippet trigger({ toggle })}
    <Item width="fixed" {edge} selected={open} disabled={!editable && !onhide && !onsort} onclick={toggle}>
      <PropertyIcon {definition} /><span class="truncate">{definition.name}</span>
      {#if sorted === "asc"}<ArrowUp size={13} class="shrink-0 text-accent" />{:else if sorted === "desc"}<ArrowDown size={13} class="shrink-0 text-accent" />{/if}
      {#if marker}<span class="ml-auto shrink-0 truncate text-[11px] text-ink-30" title="Part of {marker}: renaming or deleting it asks whether the trait changes too">{marker}</span>{/if}
    </Item>
  {/snippet}
  {#snippet children({ close })}
    <div class="space-y-1 p-1">
    {#if onsort}
      <div class="flex gap-1">
        <button class="menu-item flex-1 {sorted === 'asc' ? 'text-accent' : ''}" onclick={() => { close(); onsort(sorted === "asc" ? null : "asc"); }}><ArrowUp size={16} /> Ascending</button>
        <button class="menu-item flex-1 {sorted === 'desc' ? 'text-accent' : ''}" onclick={() => { close(); onsort(sorted === "desc" ? null : "desc"); }}><ArrowDown size={16} /> Descending</button>
      </div>
    {/if}
    {#if target && editable}
      <div class="flex items-center">
      <Popover bind:open={choosingIcon} width="w-auto">
        {#snippet trigger({ toggle })}
          <button class="grid size-7 shrink-0 place-items-center rounded-md text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink [&>*]:scale-90" aria-label="Property icon" onclick={toggle}>
            <PropertyIcon {definition} />
          </button>
        {/snippet}
        {#snippet children({ close: done })}
          <EmojiPicker iconsOnly current={definition.icon}
            onpick={(icon) => { done(); updateProperty(target, definition.name, { icon }); }}
            onremove={definition.icon ? () => { done(); updateProperty(target, definition.name, { icon: undefined }); } : undefined}
          />
        {/snippet}
      </Popover>
      <TypePicker {target} {definition}>
        {#snippet trigger({ toggle })}
          <button class="flex h-7 min-w-0 items-center rounded-md px-1.5 text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink" aria-label="Property type" onclick={toggle}>
            <span class="truncate text-[12px]">{typeLabel(definition)}</span>
          </button>
        {/snippet}
      </TypePicker>
      <span class="ml-auto"></span>
      {#if onhide}{@render hideButton(close)}{/if}
      <button class="grid size-7 shrink-0 place-items-center rounded-md text-hot transition-colors" aria-label="Delete property" title="Delete property" onclick={() => { close(); removeProperty(target, definition.name); }}><Trash2 size={16} /></button>
      </div>
      <TextField bind:ref={nameField} class="w-full" aria-label="Property name" value={definition.name}
        onchange={(e) => e.currentTarget.value.trim() && updateProperty(target, definition.name, { name: e.currentTarget.value.trim() })}
        onkeydown={(e) => e.key === "Escape" && (e.currentTarget.value = definition.name)} />
      {#if definition.type === "select" || definition.type === "multi_select"}
        <OptionsEditor {target} {definition} />
      {:else if definition.type === "date"}
        <label class="flex h-9 items-center gap-2.5 px-2.5 text-[13px] text-ink-45"><CalendarDays size={16} /> Format
          <SelectMenu class="flex-1 bg-ink-5" label="Date format" value={definition.dateFormat ?? "short"}
            choices={DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABELS[f] }))}
            onpick={(dateFormat) => updateProperty(target, definition.name, { dateFormat })} />
        </label>
      {:else if definition.type === "number"}
        <label class="flex h-9 items-center gap-2.5 px-2.5 text-[13px] text-ink-45"><Hash size={16} /> Format
          <SelectMenu class="flex-1 bg-ink-5" label="Number format" value={definition.numberFormat ?? "plain"}
            choices={NUMBER_FORMATS.map((f) => ({ value: f, label: NUMBER_FORMAT_LABELS[f] }))}
            onpick={(numberFormat) => updateProperty(target, definition.name, { numberFormat })} />
        </label>
      {:else if definition.type === "button" || definition.type === "formula"}
        <button class="menu-item text-ink-45" onclick={() => { close(); codeEditor.edit(target, definition.name); }}><Code size={16} /> Edit {definition.type}</button>
      {:else if definition.type === "relation"}
        <div class="flex h-9 items-center gap-2.5 px-2.5 text-[13px] text-ink-45"><Shapes size={16} /> Traits
          <TraitsMenu class="flex-1 bg-ink-5" {target} {definition} />
        </div>
      {/if}
    {:else}
      <div class="flex items-center">
        <p class="min-w-0 flex-1 truncate px-2 py-1 text-[12px] text-ink-45">{definition.name} · {typeLabel(definition)}</p>
        {#if onhide}{@render hideButton(close)}{/if}
      </div>
    {/if}
    </div>
  {/snippet}
</Popover>

{#snippet hideButton(close: () => void)}
  <button class="grid size-7 shrink-0 place-items-center rounded-md text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink" aria-label="Hide in this view" title="Hide in this view"
    onclick={() => { close(); onhide?.(); }}><EyeOff size={16} /></button>
{/snippet}
