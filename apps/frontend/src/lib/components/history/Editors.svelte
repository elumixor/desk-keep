<script lang="ts">
  import AuthorAvatar from "./AuthorAvatar.svelte";
  import type { Author } from "./author";

  /** Who edited the page as a row of overlapping faces, latest on the left; past a few, how many more. */
  let { authors }: { authors: readonly Author[] } = $props();

  const SHOWN = 4;
  const more = $derived(authors.length - SHOWN);
</script>

<span class="flex items-center">
  <span class="flex -space-x-1.5">
    {#each authors.slice(0, SHOWN) as author (author.id)}
      <span class="rounded-full ring-2 ring-page"><AuthorAvatar {author} /></span>
    {/each}
  </span>
  {#if more > 0}<span class="ml-1 text-[12px] tabular-nums">+{more}</span>{/if}
</span>
