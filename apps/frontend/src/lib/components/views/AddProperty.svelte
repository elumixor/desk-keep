<script lang="ts">
  import { Plus } from "lucide-svelte";
  import type { PropertyDefinition, PropertyType } from "$model/properties";
  import { typeChoices, typePick } from "$lib/property-types";
  import { extensions } from "$lib/stores/extensions.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import ChoiceList from "../ui/ChoiceList.svelte";
  import Popover from "../ui/Popover.svelte";
  import Item from "../ui/Item.svelte";

  /** Picks a type for a new property, which `onpick` adds where it belongs; with `label`, the trigger is that text (on the text's edge with `edge`, as Item). */
  let { onpick, label, edge = false, align = label ? "start" : "end" }: { onpick: (type: PropertyType, extra?: Partial<PropertyDefinition>) => void; label?: string; edge?: boolean; align?: "start" | "end" } = $props();
  let open = $state(false);

  $effect(() => {
    if (open && workspace.id) void extensions.load(workspace.id);
  });

  function pick(value: string) {
    const picked = typePick(value);
    if (!picked) return;
    open = false;
    onpick(picked.type, picked.extra);
  }
</script>

<Popover bind:open {align} width="w-56">
  {#snippet trigger({ toggle })}
    {#if label}
      <Item {edge} selected={open} onclick={toggle}><Plus size={16} /> {label}</Item>
    {:else}
    <button class="grid h-8 w-9 place-items-center rounded-sm text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink" aria-label="Add a property" onclick={toggle}><Plus size={16} /></button>
    {/if}
  {/snippet}
  {#snippet children()}
    <ChoiceList label="Property type" choices={typeChoices()} onpick={pick} />
  {/snippet}
</Popover>
