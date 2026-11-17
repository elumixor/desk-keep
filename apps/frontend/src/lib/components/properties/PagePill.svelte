<script lang="ts">
  import { FileText } from "lucide-svelte";
  import { pageHref } from "$lib/actions";
  import { titles } from "$lib/stores/titles.svelte";
  import { clipToFit } from "$lib/clip";
  import { local } from "$lib/sync/local.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import KindPill from "../ui/KindPill.svelte";

  /** A page a value points to (a relation's, a formula's), as a link with its icon and title. */
  let { id }: { id: string } = $props();
  const pill = $derived(titles.get(id));

</script>

{#if pill}
  <a class="animate-appear inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-sm px-1 text-[14px] underline decoration-ink-20 underline-offset-[3px] hover:bg-ink-5" href={pageHref(id)} onclick={(e) => e.stopPropagation()}
    >{#if pill.icon}<IconGlyph icon={pill.icon} size={14} />{:else}<FileText size={14} class="shrink-0 text-ink-45" />{/if}<span class="relative block min-w-0 overflow-hidden whitespace-nowrap" use:clipToFit={pill.title}></span><KindPill kind={local.page(id)?.kind} /></a
  >
{:else}
  <span class="inline-block h-5 w-20 animate-pulse rounded-full bg-ink-5 align-middle"></span>
{/if}
