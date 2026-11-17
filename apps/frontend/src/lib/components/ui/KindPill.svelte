<script lang="ts">
  import { viewIcon } from "$lib/view-icon";
  import { Shapes } from "lucide-svelte";
  import type { NodeKind } from "$model/nodes";

  /** Says a trait or a view is one, beside its name, by icon; a page says nothing. */
  let { kind, id, class: className = "" }: { kind?: NodeKind | null; id?: string | null; class?: string } = $props();
  const ViewIcon = $derived(viewIcon(id));
</script>

{#if kind === "trait" || kind === "view"}
  <span class="inline-flex items-center shrink-0 rounded-full px-1.5 py-1 hover:bg-ink-10 align-middle leading-4 text-ink-45 no-underline {className}" title={kind} aria-label={kind}>{#if kind === "trait"}<Shapes size={11} />{:else}<ViewIcon size={11} />{/if}</span>
{/if}
