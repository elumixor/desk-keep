<script lang="ts">
  import { Check, Plus, Trash2 } from "lucide-svelte";
  import type { PropertyDefinition, SelectOption } from "$model/properties";
  import { TAG, TAG_COLORS, tagStyle } from "$lib/tags";
  import { addOption, type SchemaTarget, updateProperty } from "$lib/schema";
  import Popover from "../ui/Popover.svelte";
  import TextField from "../ui/TextField.svelte";

  /** A select property's options as pills: one opens to rename it, pick its colour or delete it; the button adds one. */
  let { target, definition }: { target: SchemaTarget; definition: PropertyDefinition } = $props();

  const options = $derived(definition.options ?? []);
  const write = (next: SelectOption[]) => updateProperty(target, definition.name, { options: next });
  const change = (id: string, patch: Partial<SelectOption>) => write(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  let opening = $state<string>();

  function add() {
    let n = options.length + 1;
    while (options.some((o) => o.name === `Option ${n}`)) n++;
    opening = addOption(target, definition.name, `Option ${n}`);
  }
</script>

<div class="flex flex-wrap items-center gap-1 px-1.5 py-1">
  {#each options as option (option.id)}
    <Popover open={opening === option.id} width="w-56">
      {#snippet trigger({ toggle })}
        <button class="{TAG} transition-[filter] hover:brightness-95" style={tagStyle(option.color)} onclick={toggle}>{option.name}</button>
      {/snippet}
      {#snippet children({ close })}
        <div class="space-y-1 p-1">
          <TextField class="h-9 w-full" aria-label="Option name" value={option.name}
            onchange={(e) => e.currentTarget.value.trim() ? change(option.id, { name: e.currentTarget.value.trim() }) : (e.currentTarget.value = option.name)}
            onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
          <div class="flex flex-wrap gap-1.5 px-1 py-1">
            {#each TAG_COLORS as color (color)}
              <button class="grid size-6 place-items-center rounded-full" style={tagStyle(color)} aria-label={color} onclick={() => change(option.id, { color })}>
                {#if (option.color ?? "gray") === color}<Check size={14} />{/if}
              </button>
            {/each}
          </div>
          <button class="menu-item text-hot" onclick={() => { close(); write(options.filter((o) => o.id !== option.id)); }}><Trash2 size={16} /> Delete</button>
        </div>
      {/snippet}
    </Popover>
  {/each}
  <button class="{TAG} gap-1 text-ink-45 transition-colors hover:bg-ink-5" aria-label="Add option" onclick={add}><Plus size={12} /> Add</button>
</div>
