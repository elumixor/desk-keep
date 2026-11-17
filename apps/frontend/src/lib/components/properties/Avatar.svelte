<script lang="ts">
  let { name, src = null }: { name: string; src?: string | null } = $props();
</script>

{#if src}
  <img {src} alt="" class="size-5 shrink-0 rounded-full object-cover" />
{:else}
  <span class="grid size-5 shrink-0 place-items-center rounded-full bg-ink-10 text-[10px] font-semibold text-ink-70">{name.slice(0, 1).toUpperCase()}</span>
{/if}
