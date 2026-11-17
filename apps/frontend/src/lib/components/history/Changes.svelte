<script lang="ts">
  import type { Version } from "$lib/api";
  import { stamp } from "$lib/time";

  /** What a version changed, at a glance: the parts it touched and how many lines of the body. */
  let { version }: { version: Version } = $props();

  const labels = $derived.by(() => {
    const { changes, author } = version;
    // The version kept for a page from before history is how the page was, not its creation.
    const created = changes.created && author ? ["Created"] : [];
    return [
      ...(changes.restoredFrom ? [`Restored from ${stamp(changes.restoredFrom)}`] : []),
      ...created,
      ...(changes.title && !changes.created ? ["Title"] : []),
      ...(changes.icon ? ["Icon"] : []),
      ...changes.properties,
    ];
  });
</script>

<span class="mt-1 flex flex-wrap items-center gap-1 text-[12px] leading-5 text-ink-45">
  {#each labels as label (label)}
    <span class="max-w-full truncate rounded-sm bg-ink-5 px-1.5">{label}</span>
  {/each}
  {#if version.changes.added}<span class="font-mono text-accent" title="Lines added">+{version.changes.added}</span>{/if}
  {#if version.changes.removed}<span class="font-mono text-hot" title="Lines removed">−{version.changes.removed}</span>{/if}
</span>
