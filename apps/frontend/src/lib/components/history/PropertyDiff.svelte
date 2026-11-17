<script lang="ts">
  import { ArrowRight } from "lucide-svelte";
  import type { PropertyChange } from "$model/history";
  import PropertyValue from "../properties/PropertyValue.svelte";

  /** Each changed property's value as it was and as it became. */
  let { changes }: { changes: readonly PropertyChange[] } = $props();
  const ignore = () => {};
</script>

<dl class="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14px]">
  {#each changes as { name, before, after } (name)}
    <dt class="truncate py-1 text-ink-45" title={name}>{name}</dt>
    <dd class="flex min-w-0 flex-wrap items-center gap-1.5">
      {#if before}
        <span class="min-w-0 max-w-full rounded-sm bg-hot/10 opacity-70" aria-label="Was">
          <PropertyValue definition={before.definition} value={before.value} editable={false} onchange={ignore} />
        </span>
        <ArrowRight size={12} class="shrink-0 text-ink-30" />
      {/if}
      {#if after}
        <span class="min-w-0 max-w-full rounded-sm bg-accent/10" aria-label="Now">
          <PropertyValue definition={after.definition} value={after.value} editable={false} onchange={ignore} />
        </span>
      {:else}
        <span class="py-1 text-ink-45">Removed</span>
      {/if}
    </dd>
  {/each}
</dl>
