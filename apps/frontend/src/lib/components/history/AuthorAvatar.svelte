<script lang="ts">
  import { History } from "lucide-svelte";
  import type { Version } from "$lib/api";
  import { people } from "$lib/stores/people.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import { authorName } from "./author";

  let { author }: { author: Version["author"] } = $props();
  const badge = "grid size-5 shrink-0 place-items-center rounded-full";
</script>

{#if !author}
  <span class="{badge} bg-ink-10 text-ink-45"><History size={12} /></span>
{:else}
  <Avatar name={authorName(author)} src={author.avatar ?? people.avatar(author.id)} />
{/if}
