<script lang="ts">
  import { ChevronRight } from "lucide-svelte";
  import { page } from "$app/state";
  import { access } from "$lib/stores/access.svelte";
  import { sharedTree } from "$lib/stores/workspace.svelte";
  import { stored, store } from "$lib/stores/stored";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import TreeItem from "./TreeItem.svelte";

  /** The pages shared with the person in workspaces they are no member of, each with what is under it. */
  const FOLDED = "keep.shared.folded";
  let folded = $state(stored(FOLDED) === "1");
  const roots = $derived(access.sharedRoots);

  function toggle() {
    folded = !folded;
    store(FOLDED, folded ? "1" : "0");
  }
</script>

{#if roots.length}
  <section class="mt-3" aria-label="Shared with me" data-testid="shared-with-me">
    <button class="flex h-7 w-full items-center gap-1 rounded-sm px-2 text-[12px] font-medium text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink-70" aria-expanded={!folded} onclick={toggle}>
      <ChevronRight size={14} class="transition-transform {folded ? '' : 'rotate-90'}" /> Shared with me
    </button>
    {#if !folded}
      {#each roots as shared (shared.pageId)}
        {@const node = sharedTree(shared.pageId)}
        {#if node}
          <TreeItem {node} depth={0} />
        {:else}
          <!-- Not on the device yet: the next sync brings it. -->
          <a href="/w/{shared.workspaceId}/p/{shared.pageId}" class="flex h-7 items-center gap-2 rounded-sm px-2 text-ink-70 transition-colors hover:bg-ink-5 hover:text-ink {page.params.page === shared.pageId ? 'bg-ink-10 text-ink' : ''}">
            {#if shared.icon}<IconGlyph icon={shared.icon} size={16} />{/if}
            <span class="truncate">{shared.title || "Untitled"}</span>
          </a>
        {/if}
      {/each}
    {/if}
  </section>
{/if}
