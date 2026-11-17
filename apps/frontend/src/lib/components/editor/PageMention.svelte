<script lang="ts">
  import { viewIcon } from "$lib/view-icon";
  import { ArrowUpRight, FileText, Rows3, Shapes, Trash2 } from "lucide-svelte";
  import { clipToFit } from "$lib/clip";
  import { local } from "$lib/sync/local.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";

  /**
   * A page named in text: its icon with a link arrow in the corner, then its name, a pill after it on a trait or view; a
   * page in the trash says so. `plain` drops the pill. A view named here can be shown inline instead (`onexpand`).
   */
  let { id, label, saved, onexpand, plain = false, fit = false }: { id: string; label: string; saved: string | null; onexpand?: () => void; plain?: boolean; fit?: boolean } = $props();

  const page = $derived(local.page(id));
  // A page in the trash leaves the synced records, so one missing once they are in is in the trash.
  const trashed = $derived(local.ready && !page);
  const icon = $derived(page ? page.icon : saved);
  const title = $derived(page ? page.title || "Untitled" : label || "Untitled");
  const Fallback = $derived(page?.kind === "view" ? viewIcon(id) : page?.kind === "trait" ? Shapes : FileText);
</script>

<span class="mention-icon shrink-0">
  {#if icon}<IconGlyph {icon} size="1.1em" />{:else}<Fallback size="1.1em" />{/if}
  <span class="mention-arrow"><ArrowUpRight class="halo" size="0.7em" strokeWidth={12} /><ArrowUpRight size="0.7em" strokeWidth={4.5} /></span>
</span>&#8288;{#if fit}<span class="relative block min-w-0 overflow-hidden whitespace-nowrap" use:clipToFit={title}></span>{:else}{title}{/if}{#if !plain && (page?.kind === "trait" || page?.kind === "view")}<span class="mention-kind" title={page.kind}>{#if page.kind === "trait"}<Shapes size="1em" />{:else}<Fallback size="1em" />{/if}</span>{/if}{#if trashed}<span class="mention-trash"><Trash2 size="0.8em" />Removed</span>{/if}{#if onexpand && page?.kind === "view"}<button
    class="mention-expand"
    title="Show the view here"
    aria-label="Show inline"
    contenteditable="false"
    onmousedown={(e) => e.preventDefault()}
    onclick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onexpand?.();
    }}><Rows3 size="0.85em" /></button>{/if}
