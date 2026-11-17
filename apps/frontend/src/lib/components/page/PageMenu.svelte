<script lang="ts">
  import { Archive, ArchiveRestore, Eye, Link, MoveHorizontal, Trash2 } from "lucide-svelte";
  import type { Page } from "$lib/api";
  import { copyPageLink, setArchived } from "$lib/page-menu";
  import { watches } from "$lib/stores/watches.svelte";
  import History from "../history/History.svelte";
  import Watchers from "./Watchers.svelte";

  let {
    page,
    canEdit,
    canDelete = canEdit,
    wide,
    onwide,
    onremove,
  }: {
    page: Page;
    canEdit: boolean;
    /** May move it to the trash: full access, more than editing. */
    canDelete?: boolean;
    wide: boolean;
    onwide: (wide: boolean) => void;
    onremove: () => void;
  } = $props();

  const button = "grid size-7 place-items-center rounded-sm transition-colors hover:bg-ink-5 hover:text-ink";
  const watching = $derived(watches.isWatching(page.id));
</script>

<div class="flex items-center gap-0.5 text-ink-45">
  {#if page.kind === "page"}
    <button class={button} class:bg-ink-5={watching} class:text-ink={watching} title={watching ? "Stop watching" : "Watch: get notified of changes"} aria-label={watching ? "Stop watching" : "Watch"} aria-pressed={watching} onclick={() => watches.toggle(page.id)}>
      <Eye size={16} />
    </button>
    <Watchers pageId={page.id} {button} />
  {/if}
  <History {page} {canEdit} {button} />
  <button class={button} class:bg-ink-5={wide} class:text-ink={wide} title="Full width" aria-label="Full width" aria-pressed={wide} onclick={() => onwide(!wide)}><MoveHorizontal size={16} /></button>
  <button class={button} title="Copy link" aria-label="Copy link" onclick={() => void copyPageLink(page.id)}><Link size={16} /></button>
  {#if canEdit && page.parentId && page.kind === "page"}
    {#if page.archivedAt}
      <button class={button} title="Restore from archive" aria-label="Restore from archive" onclick={() => setArchived(page.id, false)}><ArchiveRestore size={16} /></button>
    {:else}
      <button class={button} title="Archive: out of the sidebar and views, still found by search" aria-label="Archive" onclick={() => setArchived(page.id, true)}><Archive size={16} /></button>
    {/if}
  {/if}
  {#if canDelete && page.parentId}
    <button class="{button} hover:text-hot" title="Move to trash" aria-label="Move to trash" onclick={onremove}><Trash2 size={16} /></button>
  {/if}
</div>
