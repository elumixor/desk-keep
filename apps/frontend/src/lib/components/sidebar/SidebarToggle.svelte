<script lang="ts">
  import { PanelLeftOpen } from "lucide-svelte";
  import { sidebar } from "$lib/stores/sidebar.svelte";
</script>

{#if !sidebar.open}
  <button
    class="grid size-7 shrink-0 place-items-center rounded-sm text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink"
    aria-label="Show sidebar"
    onclick={() => sidebar.toggle()}><PanelLeftOpen size={16} /></button
  >
{/if}
