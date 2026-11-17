<script lang="ts">
  import { Shapes } from "lucide-svelte";
  import { fade, scale } from "svelte/transition";
  import { traitChanges } from "$lib/stores/trait-changes.svelte";

  /**
   * Asks where a change to a trait's property is made: on the trait, so every page having it follows (one row per
   * trait), or only here, which takes this page out of those traits — or, dropping a trait's property, whether its
   * pages keep it.
   */
  const change = $derived(traitChanges.pending);
  const pages = (n: number) => (n === 1 ? "1 page" : `${n} pages`);
  const names = $derived(change?.traits.map((t) => t.name).join(", ") ?? "");
  const HEADING = {
    rename: (c: NonNullable<typeof change>) => `Rename “${c.property}” to “${c.to}”`,
    retype: (c: NonNullable<typeof change>) => `Make “${c.property}” a ${c.to.replace("_", " ")}`,
    delete: (c: NonNullable<typeof change>) => `Delete “${c.property}”`,
    drop: (c: NonNullable<typeof change>) => `Remove “${c.property}” from ${c.traits[0]?.name}`,
  };
  const VERB = { rename: "Rename", retype: "Change", delete: "Delete", drop: "Remove" };
  const row = "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-ink-5 focus-visible:bg-ink-5 outline-none";

  /** Runs the choice on the change as asked: closing clears it. */
  function choose(run: (asked: NonNullable<typeof change>) => void) {
    const asked = traitChanges.pending;
    traitChanges.close();
    if (asked) run(asked);
  }
</script>

<svelte:window onkeydown={(e) => change && e.key === "Escape" && traitChanges.close()} />

{#if change}
  <div class="fixed inset-0 z-40 bg-black/20" transition:fade={{ duration: 100 }} role="presentation" onclick={() => traitChanges.close()}></div>
  <div
    class="fixed top-1/3 left-1/2 z-50 w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-2 text-[14px] shadow-float"
    role="dialog"
    aria-modal="true"
    aria-label={HEADING[change.what](change)}
    data-testid="trait-change"
    transition:scale={{ start: 0.97, duration: 120 }}
  >
    <p class="px-3 pt-2 pb-1 font-medium">{HEADING[change.what](change)}</p>
    {#if change.what === "drop"}
      <p class="px-3 pb-2 text-[13px] text-ink-45">{pages(change.traits[0]?.pages ?? 0)} have it through this trait.</p>
      <button class={row} onclick={() => choose((c) => c.here())}>
        <span><span class="block">Keep it on the pages</span><span class="text-[13px] text-ink-45">With their values; only the trait stops asking for it</span></span>
      </button>
      <button class={row} onclick={() => choose((c) => c.onTrait(c.traits[0]))}>
        <span><span class="block text-hot">Remove it from the pages too</span><span class="text-[13px] text-ink-45">Their values for it go</span></span>
      </button>
    {:else}
      <p class="px-3 pb-2 text-[13px] text-ink-45">This page has it as part of {names}.</p>
      {#each change.traits as trait (trait.id)}
        <button class={row} onclick={() => choose((c) => c.onTrait(trait))}>
          {#if trait.icon}<span class="w-4 text-center">{trait.icon}</span>{:else}<Shapes size={16} class="mt-0.5 shrink-0 text-ink-45" />{/if}
          <span><span class="block">{VERB[change.what]} in {trait.name}</span><span class="text-[13px] text-ink-45">And on all {pages(trait.pages)} having it</span></span>
        </button>
      {/each}
      <button class={row} onclick={() => choose((c) => c.here())}>
        <span class="w-4"></span>
        <span><span class="block">Only on this page</span><span class="text-[13px] text-ink-45">It will no longer be {names}</span></span>
      </button>
    {/if}
    <div class="flex justify-end px-1 pt-1">
      <button class="h-8 rounded-sm px-3 text-ink-45 hover:bg-ink-5 hover:text-ink" onclick={() => traitChanges.close()}>Cancel</button>
    </div>
  </div>
{/if}
