<script lang="ts">
  import { LoaderCircle, Pencil } from "lucide-svelte";
  import type { PropertyDefinition } from "$model/properties";
  import { pressButton } from "$lib/actions";
  import { codeEditor } from "$lib/stores/code-editor.svelte";

  /**
   * A button property's button: pressed, it runs its script on the page, and pointed at, it offers its script to edit.
   * Without a page it is only shown.
   */
  let { definition, pageId, editable }: { definition: PropertyDefinition; pageId?: string; editable: boolean } = $props();
  let running = $state(false);

  async function press() {
    if (!pageId) return;
    running = true;
    await pressButton(pageId, definition.name);
    running = false;
  }
</script>

<span class="group/button inline-flex max-w-full items-center gap-0.5">
  <button class="mx-1 inline-flex h-7 min-w-0 items-center gap-1.5 rounded-sm px-2 text-[13px] text-ink-70 shadow-panel transition-colors enabled:hover:bg-ink-5 disabled:opacity-60"
    disabled={!editable || !pageId || running} onclick={press}>
    {#if running}<LoaderCircle size={14} class="shrink-0 animate-spin text-ink-45" />{/if}
    <span class="truncate">{definition.label || definition.name}</span>
  </button>
  {#if editable && pageId}
    <button class="grid size-7 shrink-0 place-items-center rounded-sm text-ink-45 opacity-0 transition hover:bg-ink-5 hover:text-ink group-hover/button:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
      title="Edit button" aria-label="Edit button" onclick={() => codeEditor.edit({ page: pageId }, definition.name)}><Pencil size={14} /></button>
  {/if}
</span>
