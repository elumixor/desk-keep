<script lang="ts">
  import { CornerDownLeft, FileText, Plus, SquareFunction } from "lucide-svelte";
  import type { ScriptTerm } from "$model/script/terms";
  import { PROPERTY_ICONS } from "$lib/property-icons";
  import NamedIcon from "../ui/NamedIcon.svelte";

  /** What a script can use: listed by group on the left, the one pointed at explained on the right; a click inserts it. */
  let { terms, oninsert }: { terms: readonly ScriptTerm[]; oninsert: (text: string) => void } = $props();
  let active = $state(0);
  const shown = $derived(terms[active] ?? terms[0]);
</script>

{#snippet icon(term: ScriptTerm)}
  {#if term.propertyType}
    {@const Icon = PROPERTY_ICONS[term.propertyType]}<Icon size={15} class="shrink-0 text-ink-45" />
  {:else if term.icon}
    <NamedIcon icon={term.icon} size={15} class="text-ink-45" />
  {:else if term.group === "Pages"}
    <FileText size={15} class="shrink-0 text-ink-45" />
  {:else}
    <SquareFunction size={15} class="shrink-0 text-ink-45" />
  {/if}
{/snippet}

<div class="grid h-56 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] border-t border-line text-[13px]">
  <div class="overflow-y-auto border-r border-line p-1.5">
    {#each terms as term, index (term.group + term.name)}
      {#if term.group !== terms[index - 1]?.group}
        <p class="px-2 pt-2 pb-1 text-[12px] font-medium text-ink-45">{term.group}</p>
      {/if}
      <button class="group/term flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors {index === active ? 'bg-ink-5' : ''}"
        onmouseenter={() => (active = index)} onfocus={() => (active = index)} onclick={() => oninsert(term.insert)}>
        {@render icon(term)}
        <span class="flex-1 truncate {term.client ? 'script-client' : ''}">{term.name}</span>
        <CornerDownLeft size={13} class="shrink-0 text-ink-30 opacity-0 group-hover/term:opacity-100" />
      </button>
    {/each}
  </div>
  {#if shown}
    <div class="min-w-0 overflow-y-auto p-3">
      <p class="flex items-center gap-2 font-medium">{@render icon(shown)}<span class={shown.client ? "script-client" : ""}>{shown.name}</span></p>
      <p class="mt-1.5 text-ink-45">{shown.doc}</p>
      <div class="mt-3 space-y-1.5">
        {#each shown.examples as example (example)}
          <button class="group/example flex w-full items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 text-left font-mono text-[12px] text-ink-70 transition-colors hover:bg-ink-5"
            title="Insert" onclick={() => oninsert(example)}>
            <span class="min-w-0 flex-1 break-all">{example}</span>
            <Plus size={13} class="shrink-0 text-ink-30 opacity-0 group-hover/example:opacity-100" />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
