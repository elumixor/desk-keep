<script lang="ts">
  import { Pencil } from "lucide-svelte";
  import { type Assignee, type DateValue, type ExtensionValue, formulaResult, type PropertyDefinition, type PropertyValue } from "$model/properties";
  import { formulas } from "$lib/scripts/formula.svelte";
  import { codeEditor } from "$lib/stores/code-editor.svelte";
  import { local } from "$lib/sync/local.svelte";
  import { extensions } from "$lib/stores/extensions.svelte";
  import { people } from "$lib/stores/people.svelte";
  import { TAG, tagStyle } from "$lib/tags";
  import OneLine from "../ui/OneLine.svelte";
  import Popover from "../ui/Popover.svelte";
  import NamedIcon from "../ui/NamedIcon.svelte";
  import Avatar from "./Avatar.svelte";
  import ButtonPill from "./ButtonPill.svelte";
  import PagePill from "./PagePill.svelte";
  import ValueView from "./ValueView.svelte";
  import DatePicker from "./DatePicker.svelte";
  import ExtensionPicker from "./ExtensionPicker.svelte";
  import OptionPicker from "./OptionPicker.svelte";
  import PersonPicker from "./PersonPicker.svelte";
  import RelationPicker from "./RelationPicker.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * One property's value, shown and edited in place. `onadd` adds an option to the schema and returns its id; `pageId`
   * is whose button is pressed (a button without one is only shown).
   */
  let {
    definition,
    value,
    editable,
    onchange,
    onadd = () => "",
    pageId,
  }: {
    definition: PropertyDefinition;
    value: PropertyValue | undefined;
    editable: boolean;
    onchange: (value: PropertyValue | null) => void;
    onadd?: (name: string) => string;
    pageId?: string;
  } = $props();

  let open = $state(false);
  const ids = $derived(Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : []);
  /** Options still in the schema, in the order they were picked. */
  const chosen = $derived(ids.flatMap((id) => definition.options?.find((o) => o.id === id) ?? []));
  const chosenCount = $derived(definition.type === "select" || definition.type === "multi_select" ? chosen.length : ids.length);
  const date = $derived(value && typeof value === "object" && "start" in value ? (value as DateValue) : null);
  const assignees = $derived(Array.isArray(value) ? (value as Assignee[]) : []);
  const extensionValues = $derived(
    definition.type !== "extension" || value === undefined || value === null ? [] : ((Array.isArray(value) ? value : [value]) as ExtensionValue[]),
  );
  const extensionType = $derived(definition.type === "extension" ? extensions.typeOf(definition) : undefined);
  /** A formula's result as computed here from the page as it is now (`formulas`), else as the server stored it. */
  const result = $derived.by(() => {
    if (definition.type !== "formula") return null;
    const page = pageId ? local.page(pageId) : undefined;
    return formulaResult(definition, page ? formulas.values(page)[definition.name] : value);
  });
  </script>

{#if definition.type === "text" || definition.type === "url"}
  {#if !editable && definition.type === "url" && value}
    <ValueView {definition} {value} />
  {:else}
    <TextField variant="ghost" class="w-full" type={definition.type === "url" ? "url" : "text"} readonly={!editable} value={value ?? ""} placeholder="Empty"
      onchange={(e) => onchange(e.currentTarget.value || null)} />
  {/if}
{:else if (definition.type === "number" || definition.type === "date") && !editable}
  <ValueView {definition} {value} />
{:else if definition.type === "number"}
  <TextField variant="ghost" class="w-full font-mono" type="number" readonly={!editable} value={value ?? ""} placeholder="Empty"
    onchange={(e) => onchange(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))} />
{:else if definition.type === "checkbox"}
  <input type="checkbox" class="mx-1.5 size-4 accent-[var(--accent)]" disabled={!editable} checked={value === true} onchange={(e) => onchange(e.currentTarget.checked)} />
{:else if definition.type === "extension" && (!editable || !extensionType || extensionType.readOnly || !extensionType.options)}
  <span class="flex min-h-7 min-w-0 items-center px-1.5 py-0.5" title={extensionType ? undefined : "Its extension is not installed"}>
    <OneLine items={extensionValues} key={(item) => item.urn} class="flex-1">
      {#snippet item(value)}{@render chip(value)}{/snippet}
    </OneLine>
  </span>
{:else if definition.type === "formula"}
  <span class="group/formula flex min-h-7 w-full min-w-0 items-center gap-0.5">
    <!-- Drawn as the property its result is (text, a number, pages…), read only, the pencil right after it. -->
    {#if result}<ValueView definition={result.definition} value={result.value} />{/if}
    {#if editable && pageId}
      <button class="grid size-7 shrink-0 place-items-center rounded-sm text-ink-45 opacity-0 transition hover:bg-ink-5 hover:text-ink group-hover/formula:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
        title="Edit formula" aria-label="Edit formula" onclick={() => codeEditor.edit({ page: pageId }, definition.name)}><Pencil size={14} /></button>
    {/if}
  </span>
{:else if definition.type === "button"}
  <ButtonPill {definition} {pageId} {editable} />
{:else if definition.type === "date"}
  <Popover bind:open width="w-72" block>
    {#snippet trigger({ toggle })}
      <button class="flex min-h-7 w-full min-w-0 items-center rounded-sm px-1.5 py-1 text-left text-[14px] transition-colors hover:bg-ink-5" onclick={toggle}>
        {#if date}<span class="-mx-1.5 flex min-w-0"><ValueView {definition} {value} /></span>{:else}<span class="text-ink-30">Empty</span>{/if}
      </button>
    {/snippet}
    {#snippet children()}
      <DatePicker value={date} onpick={(next) => onchange(next)} />
    {/snippet}
  </Popover>
{:else}
  <Popover bind:open width="w-64" block>
    {#snippet trigger({ toggle })}
      {@const pills = (definition.type === "select" || definition.type === "multi_select") && chosen.length > 0}
      <!-- Pills say they are pointed at by darkening themselves: a wash behind them would swallow them. -->
      <button class="group/value flex min-h-7 w-full min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-left transition-colors {pills ? '' : 'enabled:hover:bg-ink-5'}" disabled={!editable} onclick={toggle}>
        {#if definition.type === "select" || definition.type === "multi_select"}
          <OneLine items={chosen} key={(option) => option.id} class="-ml-1 flex-1">
            {#snippet item(option)}<span class="{TAG} transition-[filter] {editable ? 'group-hover/value:brightness-95' : ''}" style={tagStyle(option.color)}>{option.name}</span>{/snippet}
          </OneLine>
        {:else if definition.type === "person"}
          <OneLine items={assignees} key={(a) => a.id} gap="gap-2" class="flex-1">
            {#snippet item(a)}
              <span class="flex items-center gap-1.5">
                <Avatar name={people.name(a.id) ?? "?"} src={people.avatar(a.id)} />
                <span class="whitespace-nowrap text-[14px]">{people.name(a.id) ?? "Someone"}</span>
              </span>
            {/snippet}
          </OneLine>
        {:else if definition.type === "extension"}
          <OneLine items={extensionValues} key={(item) => item.urn} class="flex-1">
            {#snippet item(value)}{@render chip(value)}{/snippet}
          </OneLine>
        {:else if definition.type === "relation"}
          <span class="flex min-w-0 flex-1 flex-col items-start">
            {#each ids.slice(0, 5) as id (id)}<PagePill {id} />{/each}
            {#if ids.length > 5}<span class="px-1 text-[12px] text-ink-30">{ids.length - 5} more</span>{/if}
          </span>
        {/if}
        {#if (definition.type === "person" ? assignees.length : definition.type === "extension" ? extensionValues.length : chosenCount) === 0}<span class="order-first text-ink-30">Empty</span>{/if}
      </button>
    {/snippet}
    {#snippet children()}
      {#if definition.type === "select" || definition.type === "multi_select"}
        <OptionPicker {definition} options={definition.options ?? []} selected={ids} multiple={definition.type === "multi_select"} {onadd}
          onpick={(next) => { onchange(definition.type === "select" ? (next[0] ?? null) : next); if (definition.type === "select") open = false; }} />
      {:else if definition.type === "person"}
        <PersonPicker value={assignees} {pageId} onpick={(next) => onchange(next)} />
      {:else if definition.type === "relation"}
        <RelationPicker value={ids} onpick={(next) => onchange(next)} />
      {:else if definition.type === "extension" && extensionType}
        <ExtensionPicker {definition} type={extensionType} value={extensionValues}
          onpick={(next, done) => { onchange(extensionType.multiple ? next : (next[0] ?? null)); if (done) open = false; }} />
      {/if}
    {/snippet}
  </Popover>
{/if}

{#snippet chip(item: ExtensionValue)}
  <span class="inline-flex h-6 max-w-full items-center gap-1 rounded-sm bg-ink-5 px-1.5 text-[13px]" title={item.label} data-urn={item.urn}>
    <NamedIcon icon={item.icon ?? extensionType?.icon} size={14} class="text-ink-45" />
    <span class="truncate">{item.label}</span>
  </span>
{/snippet}
