<script lang="ts">
  import type { DiffPart } from "$model/history";

  let { parts }: { parts: readonly DiffPart[] } = $props();
</script>

<!-- One line: whitespace between the parts would show inside the text. -->
{#each parts as part, i (i)}{#if part.change === "added"}<ins class="rounded-sm bg-accent/20 no-underline">{part.text}</ins>{:else if part.change === "removed"}<del class="rounded-sm bg-hot/20 decoration-hot/60">{part.text}</del>{:else}{part.text}{/if}{/each}
