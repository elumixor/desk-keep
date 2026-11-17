<script lang="ts">
  import { confirm } from "$lib/stores/confirm.svelte";
  import { fade, scale } from "svelte/transition";
  import TextField from "./TextField.svelte";

  let input = $state<HTMLInputElement>();

  $effect(() => {
    if (input) {
      input.focus();
      input.select();
    }
  });

  // Captured on the window, so the tree's own keys under the dialog never see them.
  function onKey(event: KeyboardEvent) {
    if (!confirm.ask || event.isComposing) return;
    if (event.key === "Enter") confirm.yes();
    else if (event.key === "Escape") confirm.no();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if confirm.ask}
  {@const { text, action, danger } = confirm.ask}
  <div class="fixed inset-0 z-50 grid place-items-center bg-[var(--backdrop)] px-4" role="presentation" transition:fade={{ duration: 100 }} onmousedown={(e) => e.target === e.currentTarget && confirm.no()}>
    <div class="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-float" role="alertdialog" aria-label={text} transition:scale={{ start: 0.97, duration: 120 }}>
      <p class="text-[15px]">{text}</p>
      {#if confirm.ask.value !== undefined}
        <TextField bind:ref={input} bind:value={confirm.ask.value} class="mt-3 h-8 w-full" />
      {/if}
      <div class="mt-5 flex justify-end gap-2">
        <button class="h-8 rounded-sm px-3 text-ink-70 transition-colors hover:bg-ink-5" onclick={() => confirm.no()}>Cancel</button>
        <button class="h-8 rounded-sm px-3 font-medium text-page transition-colors {danger ? 'bg-hot hover:bg-hot/90' : 'bg-accent hover:bg-accent/90'}" onclick={() => confirm.yes()}>{action}</button>
      </div>
    </div>
  </div>
{/if}
