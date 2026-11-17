<script lang="ts">
  import { SmilePlus } from "lucide-svelte";
  import { me } from "$lib/stores/me.svelte";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import { reactions } from "$lib/stores/reactions.svelte";
  import { local } from "$lib/sync/local.svelte";
  import EmojiPicker from "../ui/EmojiPicker.svelte";
  import Popover from "../ui/Popover.svelte";

  /**
   * The emoji on a comment, each with how many put it there (who, on hover); one's own is lit, and a click puts it on or
   * takes it off. `canReact`: the signed-in person may comment on the page, so react too. `button`: only the button
   * that adds one, for the comment's tools while it has none (the row shows nothing then).
   */
  let { commentId, canReact, button = false }: { commentId: string; canReact: boolean; button?: boolean } = $props();

  const list = $derived([...local.reactionsOf(commentId)]);
  let picking = $state(false);

  function who(authors: readonly { authorId?: string }[]) {
    const self = me.current?.peopleId;
    return authors
      .map((r) => (r.authorId === self ? "You" : ((r.authorId && peopleApi.person(r.authorId)?.name) ?? "Someone")))
      .join(", ");
  }
</script>

{#snippet add(tool: string)}
  <Popover bind:open={picking} width="w-80" align={button ? "end" : "start"}>
    {#snippet trigger({ toggle })}
      <button class={tool} aria-label="Add reaction" title="Add reaction" onclick={toggle}><SmilePlus size={14} /></button>
    {/snippet}
    {#snippet children({ close })}
      <EmojiPicker emojiOnly onpick={(emoji) => {
        close();
        if (!reactions.mine(commentId, emoji)) reactions.toggle(commentId, emoji);
      }} />
    {/snippet}
  </Popover>
{/snippet}

{#if button}
  {#if canReact && !list.length}{@render add("grid size-6 place-items-center rounded-sm text-ink-30 transition hover:bg-ink-5 hover:text-ink-70")}{/if}
{:else if list.length}
  <div class="mt-1 flex flex-wrap items-center gap-1">
    {#each list as [emoji, authors] (emoji)}
      {@const mine = reactions.mine(commentId, emoji)}
      <button
        class="flex h-6 items-center gap-1 rounded-full px-2 text-[12px] transition-colors {mine ? 'bg-accent-soft text-ink shadow-[inset_0_0_0_1px_var(--accent)]' : 'bg-ink-5 text-ink-70 enabled:hover:bg-ink-10'}"
        title={who(authors)}
        aria-label="{emoji} {authors.length}"
        aria-pressed={mine}
        disabled={!canReact}
        onclick={() => reactions.toggle(commentId, emoji)}
      ><span class="text-[14px] leading-none">{emoji}</span>{authors.length}</button>
    {/each}
    {#if canReact}{@render add("grid size-6 place-items-center rounded-full text-ink-30 transition hover:bg-ink-5 hover:text-ink-70")}{/if}
  </div>
{/if}
