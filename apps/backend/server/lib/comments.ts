import { asc, eq } from "drizzle-orm";
import { db } from "~/db";
import { comments } from "~/db/schema";
import { addedMentions, commentMentions } from "~/model/mentions";
import { personUrl } from "~/model/urn";
import { authorId, type Caller } from "./auth/caller";
import { ApiError, ForbiddenError, NotFoundError } from "./http/api-error";
import { type Outbox, transact } from "./notify/outbox";
import { withAuthors } from "./pages/versions";
import { authorizePage } from "./permissions";
import { reactionsOf } from "./reactions";

export type Comment = typeof comments.$inferSelect;

/** Only its author changes or removes a comment, and only while they may still comment on its page. */
async function authorizeComment(caller: Caller, id: string) {
  const comment = await db.query.comments.findFirst({ where: eq(comments.id, id) });
  if (!comment) throw new NotFoundError("Comment");
  await authorizePage(caller, comment.pageId, "comment");
  if (comment.authorId !== authorId(caller)) throw new ForbiddenError("Only its author changes a comment");
  return comment;
}

/**
 * Anyone with comment access to a page (a guest, a comment share and up) may comment on it. `id` is the one a client chose (`lib/sync`); sent again under it, the
 * comment is its author's to rewrite, and stays on its page. `replyTo` names the comment on the same page it answers;
 * it is set once, never changed.
 */
export async function saveComment(
  caller: Caller,
  id: string,
  pageId: string,
  body: string,
  replyTo: string | null = null,
): Promise<Comment> {
  const existing = await db.query.comments.findFirst({ where: eq(comments.id, id), columns: { pageId: true } });
  if (existing && existing.pageId !== pageId) throw new ApiError("A comment stays on its page");
  if (existing) return updateComment(caller, id, body);
  const page = await authorizePage(caller, pageId, "comment");
  let answered: { pageId: string; authorId: string } | undefined;
  if (replyTo) {
    if (replyTo === id) throw new ApiError("A comment does not answer itself");
    answered = await db.query.comments.findFirst({
      where: eq(comments.id, replyTo),
      columns: { pageId: true, authorId: true },
    });
    // The comment it answers is gone: the reply stays, as one whose parent went (`reply_to` set null).
    if (!answered) replyTo = null;
    else if (answered.pageId !== pageId) throw new ApiError("A reply answers a comment on the same page");
  }
  return transact(caller, async (tx, out) => {
    const [comment] = await tx
      .insert(comments)
      .values({
        id,
        pageId,
        workspaceId: page.workspaceId ?? page.id,
        authorId: authorId(caller),
        replyTo,
        body,
      })
      .returning();
    // The author of the comment answered is told (a reply wins over a mention of them in it).
    if (answered)
      out.notify({ type: "reply", to: answered.authorId, pageId, commentId: comment.id, text: comment.body });
    notifyMentions(out, null, comment);
    out.comment({ kind: "created", comment });
    return comment;
  });
}

/** Whoever the comment newly names is told; `before` null = written now. */
function notifyMentions(out: Outbox, before: string | null, comment: Comment) {
  for (const [to, site] of addedMentions(
    before === null ? null : commentMentions(before),
    commentMentions(comment.body),
  ))
    out.notify({
      type: "mention",
      to,
      pageId: comment.pageId,
      commentId: comment.id,
      mention: site.where,
      text: site.snippet,
    });
}

export async function updateComment(caller: Caller, id: string, body: string): Promise<Comment> {
  const current = await authorizeComment(caller, id);
  if (current.body === body) return current;
  return transact(caller, async (tx, out) => {
    const [comment] = await tx
      .update(comments)
      .set({ body, editedAt: new Date() })
      .where(eq(comments.id, id))
      .returning();
    notifyMentions(out, current.body, comment);
    out.comment({ kind: "changed", comment });
    return comment;
  });
}

export async function deleteComment(caller: Caller, id: string) {
  const comment = await authorizeComment(caller, id);
  await transact(caller, async (tx, out) => {
    await tx.delete(comments).where(eq(comments.id, id));
    out.comment({ kind: "deleted", comment });
  });
  return { id };
}

/** Comments as an assistant reads them: who wrote each (People address), what it answers, and its reactions. */
export async function commentPayloads(rows: readonly Comment[]) {
  const [authored, reactions] = await Promise.all([withAuthors(rows), reactionsOf(rows.map((r) => r.id))]);
  return authored.map((c) => ({
    id: c.id,
    pageId: c.pageId,
    replyTo: c.replyTo,
    author: c.author && { name: c.author.name, url: personUrl(c.author.id) },
    body: c.body,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    reactions: reactions.get(c.id) ?? [],
  }));
}

/**
 * A page's comments, oldest first, each with its author, what it answers and its reactions. The caller authorizes the
 * read alongside (`read_page` with `getPage`), so the page is read once: never return these before that went through.
 */
export async function commentsOn(pageId: string) {
  const rows = await db.query.comments.findMany({
    where: eq(comments.pageId, pageId),
    orderBy: asc(comments.createdAt),
  });
  return commentPayloads(rows);
}

/** One comment as an assistant reads it. */
export async function commentPayload(id: string) {
  const row = await db.query.comments.findFirst({ where: eq(comments.id, id) });
  if (!row) throw new NotFoundError("Comment");
  const [payload] = await commentPayloads([row]);
  return payload;
}
