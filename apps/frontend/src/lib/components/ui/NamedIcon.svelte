<script lang="ts">
  import { isIconName } from "$model/extensions";

  /**
   * An icon an extension names: a lucide icon by name (drawn from lucide-static as a mask, so it takes the text
   * colour and costs nothing until shown), or an image URL. Anything else draws nothing.
   */
  let { icon, size = 16, class: className = "" }: { icon: string | undefined | null; size?: number; class?: string } = $props();
  const LUCIDE = "https://cdn.jsdelivr.net/npm/lucide-static@1.0.1/icons";
  const isUrl = $derived(!!icon && /^https?:\/\//.test(icon));
</script>

{#if icon && isUrl}
  <img src={icon} alt="" width={size} height={size} class="shrink-0 rounded-xs {className}" />
{:else if isIconName(icon ?? undefined)}
  <span
    aria-hidden="true"
    class="inline-block shrink-0 bg-current {className}"
    style="width: {size}px; height: {size}px; mask: url({LUCIDE}/{icon}.svg) center / contain no-repeat; -webkit-mask: url({LUCIDE}/{icon}.svg) center / contain no-repeat"
  ></span>
{/if}
