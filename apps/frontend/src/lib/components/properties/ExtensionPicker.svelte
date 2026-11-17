<script lang="ts">
  import { Check } from "lucide-svelte";
  import { defaultFields, type ExtensionOption, type ExtensionPropertyType } from "$model/extensions";
  import type { ExtensionValue, PropertyDefinition } from "$model/properties";
  import { getJson } from "$lib/http";
  import { workspace } from "$lib/stores/workspace.svelte";
  import NamedIcon from "../ui/NamedIcon.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * Picks values of an extension's property type from its options, which Keep's server asks the app for (so the
   * extension's token stays there), and edits the fields each picked value carries.
   */
  let {
    definition,
    type,
    value,
    onpick,
  }: { definition: PropertyDefinition; type: ExtensionPropertyType; value: readonly ExtensionValue[]; onpick: (next: ExtensionValue[], done: boolean) => void } =
    $props();

  const DEBOUNCE_MS = 150;
  let query = $state("");
  let options = $state<ExtensionOption[]>([]);
  let failed = $state<string | null>(null);
  let loading = $state(true);

  $effect(() => {
    const q = query;
    const ws = workspace.id;
    if (!ws || !definition.extension) return;
    const timer = setTimeout(() => {
      getJson<ExtensionOption[]>(`/api/workspaces/${ws}/extensions/${definition.extension}/options`, { type: type.id, q })
        .then((found) => {
          if (q !== query) return;
          options = found;
          failed = null;
        })
        .catch((error) => (failed = error instanceof Error ? error.message : String(error)))
        .finally(() => (loading = false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const picked = (urn: string) => value.some((v) => v.urn === urn);

  function pick(option: ExtensionOption) {
    const chosen: ExtensionValue = {
      urn: option.urn,
      label: option.label,
      ...(option.icon && { icon: option.icon }),
      ...((fields) => (fields ? { fields } : {}))(defaultFields(type, definition.fields)),
    };
    if (!type.multiple) return onpick(picked(option.urn) ? [] : [chosen], !type.fields?.length);
    onpick(picked(option.urn) ? value.filter((v) => v.urn !== option.urn) : [...value, chosen], false);
  }

  function setField(urn: string, field: string, next: unknown) {
    onpick(value.map((v) => (v.urn === urn ? { ...v, fields: { ...v.fields, [field]: next } } : v)), false);
  }
</script>

<TextField class="mb-1 w-full" placeholder="Find in {type.name}" aria-label="Search {type.name}" bind:value={query} />
{#if failed}
  <p class="px-2 py-1.5 text-[13px] text-hot">{failed}</p>
{:else if !loading && !options.length}
  <p class="px-2 py-1.5 text-[13px] text-ink-45">Nothing found</p>
{/if}
{#each options as option (option.urn)}
  <button class="menu-item py-1" onclick={() => pick(option)}>
    <span class="grid size-4 place-items-center text-ink-45"><NamedIcon icon={option.icon ?? type.icon} /></span>
    <span class="min-w-0 flex-1">
      <span class="block truncate">{option.label}</span>
      {#if option.description}<span class="block truncate text-[12px] text-ink-45">{option.description}</span>{/if}
    </span>
    {#if picked(option.urn)}<Check size={16} />{/if}
  </button>
{/each}
{#if type.fields?.length && value.length}
  <div class="mx-1 my-1 h-px bg-line"></div>
  {#each value as item (item.urn)}
    <div class="px-2 py-1" data-testid="extension-fields">
      {#if value.length > 1}<p class="pb-1 text-[12px] font-medium text-ink-45">{item.label}</p>{/if}
      {#each type.fields as field (field.id)}
        {@const current = item.fields?.[field.id] ?? field.default}
        <label class="flex h-8 items-center gap-2 text-[13px]">
          {#if field.type === "checkbox"}
            <input type="checkbox" class="size-4 accent-[var(--accent)]" checked={current === true} onchange={(e) => setField(item.urn, field.id, e.currentTarget.checked)} />
            <span>{field.name}</span>
          {:else}
            <span class="w-28 shrink-0 truncate text-ink-45">{field.name}</span>
            <TextField class="h-7 w-full" type={field.type === "number" ? "number" : "text"} value={current ?? ""}
              onchange={(e) => setField(item.urn, field.id, field.type === "number" ? Number(e.currentTarget.value) : e.currentTarget.value)} />
          {/if}
        </label>
      {/each}
    </div>
  {/each}
{/if}
