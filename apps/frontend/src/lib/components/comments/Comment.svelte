<script lang="ts">
  import { Copy, CornerUpLeft, Pencil, Trash2 } from "lucide-svelte";
  import type { CommentRecord } from "$model/sync";
  import { refsPlainText } from "$model/refs";
  import { copyText } from "$lib/page-menu";
  import { comments } from "$lib/stores/comments.svelte";
  import { menu } from "$lib/stores/context-menu.svelte";
  import { access } from "$lib/stores/access.svelte";
  import { me } from "$lib/stores/me.svelte";
  import { now } from "$lib/stores/now.svelte";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import { local } from "$lib/sync/local.svelte";
  import { brief, stamp } from "$lib/time";
  import Avatar from "../properties/Avatar.svelte";
  import CommentInput from "./CommentInput.svelte";
  import CommentText from "./CommentText.svelte";
  import Reactions from "./Reactions.svelte";

  /**
   * One comment: who wrote it and when, the comment it answers (quoted; a click goes to it), its text with mentions, its
   * reactions; a Reply for whoever may comment, and for its author a way to rewrite or remove it. Anchored as
   * `#comment-<id>`.
   */
  let { comment, onreply }: { comment: CommentRecord; onreply?: (id: string) => void } = $props();

  /** Who wrote a comment, by their People id: the signed-in person as they are, anyone else as People has them. */
  function authorOf(authorId: string | undefined) {
    const self = me.current;
    if (self && authorId === self.peopleId) return { name: self.name, avatar: self.avatar, self: true };
    const person = authorId ? peopleApi.person(authorId) : null;
    return { name: person?.name ?? "Someone", avatar: person?.avatar ?? null, self: false };
  }

  const author = $derived(authorOf(comment.authorId));
  const canComment = $derived(access.can(comment.pageId, "comment"));
  // Its author rewrites or removes it while they may still comment on the page.
  const mine = $derived(author.self && canComment);
  const answered = $derived(comment.replyTo ? local.comment(comment.replyTo) : undefined);
  let editing = $state(false);
  let draft = $state("");
  const tool = "grid size-6 place-items-center rounded-sm text-ink-30 transition hover:bg-ink-5 hover:text-ink-70";

  function startEditing() {
    draft = comment.body;
    editing = true;
  }

  const reply = () => onreply?.(comment.id);

  const entries = () => [
    { label: "Copy text", icon: Copy, run: () => void copyText(refsPlainText(comment.body), "Comment") },
    canComment && onreply && !editing && { label: "Reply", icon: CornerUpLeft, run: reply },
    mine && !editing && "separator" as const,
    mine && !editing && { label: "Edit", icon: Pencil, run: startEditing },
    mine && !editing && { label: "Delete", icon: Trash2, danger: true, run: () => comments.remove(comment.id) },
  ];

  function save(body: string) {
    if (body !== comment.body) comments.edit(comment.id, body);
    editing = false;
  }

  /** The answered comment, scrolled to and flashed. */
  function showAnswered() {
    const target = document.getElementById(`comment-${comment.replyTo}`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.animate([{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }], { duration: 1200 });
  }
</script>

<article class="group/comment -mx-1 flex gap-2.5 rounded-sm px-1 py-1.5" id="comment-{comment.id}" data-comment={comment.id} use:menu={entries}>
  <span class="mt-0.5"><Avatar name={author.name} src={author.avatar} /></span>
  <div class="min-w-0 flex-1">
    <header class="flex h-6 items-center gap-2">
      <span class="truncate font-medium text-ink">{author.name}</span>
      {#if comment.createdAt}
        <time class="shrink-0 text-[12px] text-ink-30" datetime={comment.createdAt} title={stamp(comment.createdAt)}>{brief(comment.createdAt, now.value)}</time>
      {/if}
      {#if comment.editedAt}<span class="shrink-0 text-[12px] text-ink-30" title={stamp(comment.editedAt)}>edited</span>{/if}
      {#if !editing}
        <span class="ml-auto flex shrink-0 gap-0.5 opacity-0 transition group-hover/comment:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          <Reactions commentId={comment.id} canReact={canComment} button />
          {#if canComment && onreply}<button class={tool} aria-label="Reply" title="Reply" onclick={reply}><CornerUpLeft size={14} /></button>{/if}
          {#if mine}
            <button class={tool} aria-label="Edit comment" onclick={startEditing}><Pencil size={14} /></button>
            <button class="grid size-6 place-items-center rounded-sm text-ink-30 transition hover:text-hot" aria-label="Delete comment" onclick={() => comments.remove(comment.id)}><Trash2 size={14} /></button>
          {/if}
        </span>
      {/if}
    </header>
    {#if answered}
      {@const by = authorOf(answered.authorId)}
      <button class="mb-0.5 block w-full truncate border-l-2 border-line pl-2 text-left text-[12px] text-ink-45 hover:text-ink-70" title="Go to the comment answered" onclick={showAnswered}>
        <span class="font-medium">{by.name}</span> {refsPlainText(answered.body).split("\n")[0]}
      </button>
    {/if}
    {#if editing}
      <CommentInput bind:value={draft} pageId={comment.pageId} label="Edit comment" editing onsubmit={save} oncancel={() => (editing = false)} />
    {:else}
      <CommentText text={comment.body} class="break-words whitespace-pre-wrap text-ink" />
      <Reactions commentId={comment.id} canReact={canComment} />
    {/if}
  </div>
</article>
