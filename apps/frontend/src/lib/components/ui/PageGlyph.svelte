<script lang="ts">
  import { viewIcon } from "$lib/view-icon";
  import { FileText, Shapes } from "lucide-svelte";
  import type { NodeKind } from "$model/nodes";
  import IconGlyph from "./IconGlyph.svelte";

  /** A page's icon in a list: its own, else the glyph of what it is. */
  let { icon, kind, id, size = 16 }: { icon?: string | null; kind?: NodeKind; id?: string | null; size?: number } = $props();
  const ViewIcon = $derived(viewIcon(id));
</script>

{#if icon}<IconGlyph {icon} {size} class="shrink-0" />
{:else if kind === "view"}<ViewIcon {size} class="text-ink-45" />
{:else if kind === "trait"}<Shapes {size} class="text-ink-45" />
{:else}<FileText {size} class="text-ink-45" />{/if}
