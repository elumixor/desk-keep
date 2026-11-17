<script lang="ts">
  import { Users } from "lucide-svelte";
  import { api } from "$lib/api";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import { watches } from "$lib/stores/watches.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import Popover from "../ui/Popover.svelte";

  /** Who watches the page, asked when opened (and again when the person's own watch changes). */
  let { pageId, button }: { pageId: string; button: string } = $props();
  type Watcher = Awaited<ReturnType<ReturnType<typeof api.pages>["watchers"]["$get"]>>[number];

  let open = $state(false);
  let watchers = $state<Watcher[] | null>(null);
  let failed = $state(false);

  $effect(() => {
    if (!open) return;
    void watches.isWatching(pageId);
    failed = false;
    api.pages(pageId).watchers.$get().then(
      (list) => (watchers = list),
      () => (failed = true),
    );
  });
</script>

<Popover bind:open align="end" width="w-60">
  {#snippet trigger({ toggle })}
    <button class={button} title="Watchers" aria-label="Watchers" aria-expanded={open} onclick={toggle}><Users size={16} /></button>
  {/snippet}
  {#snippet children()}
    <p class="px-2 py-1 text-[12px] font-medium text-ink-45">Watching this page</p>
    {#if failed}
      <p class="px-2 py-1 text-[13px] text-ink-30">Could not load who watches it.</p>
    {:else if watchers === null}
      <p class="px-2 py-1 text-[13px] text-ink-30">Loading…</p>
    {:else if !watchers.length}
      <p class="px-2 py-1 text-[13px] text-ink-30">Nobody yet.</p>
    {:else}
      {#each watchers as watcher (watcher.peopleId)}
        {@const person = peopleApi.person(watcher.peopleId)}
        <div class="flex h-8 items-center gap-2 px-2 text-[13px]">
          <Avatar name={person?.name ?? "?"} src={person?.avatar} />
          <span class="min-w-0 flex-1 truncate">{person?.name ?? "Someone"}</span>
          {#if watcher.tagged}<span class="text-[11px] text-ink-30" title="Watched from {watcher.tagged} client{watcher.tagged === 1 ? '' : 's'} (an assistant's threads)">{watcher.tagged} {watcher.tagged === 1 ? "thread" : "threads"}</span>{/if}
        </div>
      {/each}
    {/if}
  {/snippet}
</Popover>
