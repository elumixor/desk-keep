<script lang="ts">
  import SelectMenu from "../ui/SelectMenu.svelte";
  import { DATE_FORMATS, NUMBER_FORMATS } from "$model/properties";
  import { DATE_FORMAT_LABELS, NUMBER_FORMAT_LABELS } from "$lib/time";
  import { Code, Trash2 } from "lucide-svelte";
  import type { PropertyDefinition } from "$model/properties";
  import { typeLabel } from "$lib/property-types";
  import { removeProperty, updateProperty } from "$lib/schema";
  import { codeEditor } from "$lib/stores/code-editor.svelte";
  import { newProperty } from "$lib/stores/new-property.svelte";
  import PropertyIcon from "../properties/PropertyIcon.svelte";
  import TypePicker from "../properties/TypePicker.svelte";
  import EmojiPicker from "../ui/EmojiPicker.svelte";
  import Popover from "../ui/Popover.svelte";
  import TraitsMenu from "../properties/TraitsMenu.svelte";
  import OptionsEditor from "../properties/OptionsEditor.svelte";
  import TextField from "../ui/TextField.svelte";

  /** One of a trait's properties, edited in place: its icon, its type, its name; a formula, relation or button's setting below. */
  let { traitId, definition, editable }: { traitId: string; definition: PropertyDefinition; editable: boolean } = $props();
  const target = $derived({ trait: traitId });
  let choosingIcon = $state(false);
  let nameField = $state<HTMLInputElement>();
  // A property just added has its name selected, to be typed over.
  $effect(() => {
    const field = nameField;
    if (!field || !editable || !newProperty.take(definition.name)) return;
    // No cleanup: taking it re-runs this effect, which must not cancel the focus.
    requestAnimationFrame(() => {
      field.focus();
      field.select();
    });
  });

  function rename(input: HTMLInputElement) {
    const name = input.value.trim();
    if (name && name !== definition.name) updateProperty(target, definition.name, { name });
    else input.value = definition.name;
  }
</script>

<div class="group/prop -ml-2 flex items-center gap-1 text-ink-70" data-property={definition.name}>
  <Popover bind:open={choosingIcon} width="w-auto">
    {#snippet trigger({ toggle })}
      <button class="grid size-8 shrink-0 place-items-center rounded-sm text-ink-45 transition-colors enabled:hover:bg-ink-5 enabled:hover:text-ink" aria-label="Property icon" disabled={!editable} onclick={toggle}>
        <PropertyIcon {definition} />
      </button>
    {/snippet}
    {#snippet children({ close })}
      <EmojiPicker iconsOnly current={definition.icon}
        onpick={(icon) => { close(); updateProperty(target, definition.name, { icon }); }}
        onremove={definition.icon ? () => { close(); updateProperty(target, definition.name, { icon: undefined }); } : undefined}
      />
    {/snippet}
  </Popover>
  {#if editable}
    <TypePicker {target} {definition}>
      {#snippet trigger({ toggle })}
        <button type="button" class="flex h-8 w-32 shrink-0 items-center truncate rounded-sm px-2 text-left text-ink-45 outline-none transition-colors hover:bg-ink-5 focus-visible:bg-ink-5" aria-label="Property type" onclick={toggle}>
          <span class="truncate">{typeLabel(definition)}</span>
        </button>
      {/snippet}
    </TypePicker>
  {:else}
    <span class="w-32 shrink-0 truncate px-2 text-ink-45">{typeLabel(definition)}</span>
  {/if}
  <TextField bind:ref={nameField} variant="ghost" class="h-8 flex-1 px-2" aria-label="Property name" value={definition.name} disabled={!editable}
    onchange={(e) => rename(e.currentTarget)} onkeydown={(e) => {
      // Escape leaves the name as it was; Enter keeps the new one.
      if (e.key === "Escape") e.currentTarget.value = definition.name;
      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
    }} />
  {#if editable}
    <button class="grid size-8 shrink-0 place-items-center rounded-sm text-ink-30 opacity-0 transition hover:bg-ink-5 hover:text-hot group-hover/prop:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
      aria-label="Delete property" onclick={() => removeProperty(target, definition.name)}><Trash2 size={16} /></button>
  {/if}
</div>
{#if editable && (definition.type === "button" || definition.type === "formula")}
  <button class="ml-[10rem] flex h-8 items-center gap-1.5 rounded-sm px-2 text-[13px] text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink" onclick={() => codeEditor.edit(target, definition.name)}><Code size={14} /> Edit {definition.type}</button>
{:else if editable && definition.type === "date"}
  <label class="ml-[10rem] flex h-8 items-center gap-1.5 px-2 text-[13px] text-ink-45">Format
    <SelectMenu class="flex-1 " label="Date format" value={definition.dateFormat ?? "short"}
            choices={DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABELS[f] }))}
            onpick={(dateFormat) => updateProperty(target, definition.name, { dateFormat })} />
  </label>
{:else if editable && definition.type === "number"}
  <label class="ml-[10rem] flex h-8 items-center gap-1.5 px-2 text-[13px] text-ink-45">Format
    <SelectMenu class="flex-1 " label="Number format" value={definition.numberFormat ?? "plain"}
            choices={NUMBER_FORMATS.map((f) => ({ value: f, label: NUMBER_FORMAT_LABELS[f] }))}
            onpick={(numberFormat) => updateProperty(target, definition.name, { numberFormat })} />
  </label>
{:else if editable && (definition.type === "select" || definition.type === "multi_select")}
  <div class="ml-[10rem]"><OptionsEditor {target} {definition} /></div>
{:else if editable && definition.type === "relation"}
  <div class="ml-[10rem] flex h-8 items-center gap-1.5 px-2 text-[13px] text-ink-45">Traits
    <TraitsMenu class="flex-1" {target} {definition} />
  </div>
{/if}
