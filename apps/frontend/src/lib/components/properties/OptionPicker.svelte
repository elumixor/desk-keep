<script lang="ts">
  import { Check, Plus } from "lucide-svelte";
  import type { SelectOption } from "$model/properties";
  import { TAG, tagStyle } from "$lib/tags";
  import type { PropertyDefinition } from "$model/properties";
  import PropertyIcon from "./PropertyIcon.svelte";
  import TextField from "../ui/TextField.svelte";

  /** Pick one option (or several, with `multiple`); typing a name that is not there offers to add it. */
  let {
    options,
    selected,
    multiple,
    definition,
    onpick,
    onadd,
  }: { options: readonly SelectOption[]; selected: readonly string[]; multiple: boolean; definition: PropertyDefinition; onpick: (ids: string[]) => void; onadd: (name: string) => string } =
    $props();

  let query = $state("");
  const shown = $derived(options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase())));
  const exact = $derived(options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase()));

  function pick(id: string) {
    if (!multiple) return onpick(selected.includes(id) ? [] : [id]);
    onpick(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  function add() {
    const name = query.trim();
    if (!name) return;
    query = "";
    pick(onadd(name));
  }
</script>

<div class="mb-1 flex items-center gap-1.5 px-2.5 text-[12px] text-ink-45"><PropertyIcon {definition} /><span class="truncate">{definition.name}</span></div>
<TextField
  class="mb-1 h-9 w-full"
  placeholder="Find or add an option"
  bind:value={query}
  onkeydown={(e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (shown[0] && (exact || !query.trim())) pick(shown[0].id);
    else add();
  }}
/>
{#each shown as option (option.id)}
  <button class="menu-item !pl-0.5" onclick={() => pick(option.id)}>
    <span class={TAG} style={tagStyle(option.color)}>{option.name}</span>
    {#if selected.includes(option.id)}<Check size={16} class="ml-auto" />{/if}
  </button>
{/each}
{#if query.trim() && !exact}
  <button class="menu-item text-ink-45" onclick={add}><Plus size={16} /> Add “{query.trim()}”</button>
{/if}
