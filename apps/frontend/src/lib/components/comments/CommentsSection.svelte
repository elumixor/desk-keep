<script lang="ts">
  import { X } from "lucide-svelte";
  import { comments } from "$lib/stores/comments.svelte";
  import { access } from "$lib/stores/access.svelte";
  import { me } from "$lib/stores/me.svelte";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import { local } from "$lib/sync/local.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import Comment from "./Comment.svelte";
  import CommentInput from "./CommentInput.svelte";

  /**
   * A page's comments under its properties, oldest first, and a box to add one while the page takes them and the
   * signed-in person may comment (a guest, a comment share and up). A reply names the comment it answers, shown above
   * the box until it is sent.
   */
  let { pageId, open }: { pageId: string; open: boolean } = $props();
  const list = $derived(local.commentsOf(pageId));
  const self = $derived(open && access.can(pageId, "comment") ? me.current : null);
  let draft = $state("");
  let replyingTo = $state<string | null>(null);
  let input = $state<ReturnType<typeof CommentInput>>();
  const answering = $derived(replyingTo ? local.comment(replyingTo) : undefined);
  const answeringName = $derived.by(() => {
    if (!answering) return "";
    if (answering.authorId && answering.authorId === me.current?.peopleId) return "yourself";
    return (answering.authorId && peopleApi.person(answering.authorId)?.name) || "Someone";
  });

  function send(body: string) {
    comments.add(pageId, body, answering ? answering.id : null);
    draft = "";
    replyingTo = null;
  }

  function reply(id: string) {
    replyingTo = id;
    input?.focus();
  }
</script>

{#if list.length || self}
  <section class="mt-4" aria-label="Comments" data-testid="comments">
    {#each list as comment (comment.id)}<Comment {comment} onreply={self ? reply : undefined} />{/each}
    {#if self}
      {#if answering}
        <p class="ml-7.5 flex h-6 items-center gap-1 text-[12px] text-ink-45">
          <span class="truncate">Replying to <span class="font-medium text-ink-70">{answeringName}</span></span>
          <button class="grid size-5 shrink-0 place-items-center rounded-sm text-ink-30 hover:bg-ink-5 hover:text-ink-70" aria-label="Cancel reply" onclick={() => (replyingTo = null)}><X size={12} /></button>
        </p>
      {/if}
      <div class="flex items-start gap-2.5 py-1">
        <span class="mt-1.5"><Avatar name={self.name} src={self.avatar} /></span>
        <CommentInput bind:this={input} bind:value={draft} {pageId} label="Add a comment" placeholder={answering ? "Reply…" : "Add a comment…"} onsubmit={send} oncancel={answering ? () => (replyingTo = null) : undefined} />
      </div>
    {/if}
  </section>
{/if}
