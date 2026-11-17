import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { commentReactions, comments } from "~/db/schema";
import { reactionEmojiSchema } from "~/model/sync";
import { personUrl } from "~/model/urn";
import { authorId, type Caller } from "./auth/caller";
import { ApiError, ForbiddenError, NotFoundError } from "./http/api-error";
import { authorizePage } from "./permissions";

export type Reaction = typeof commentReactions.$inferSelect;

const emojiOf = (emoji: string) => {
  const parsed = reactionEmojiSchema.safeParse(emoji);
  if (!parsed.success) throw new ApiError("A reaction is one emoji");
  return parsed.data;
};

/**
 * Puts the caller's emoji on a comment, for anyone who may comment on its page. Once per person and emoji: the same
 * again (a retry, a second device) adds nothing and answers null; the reaction already there is the one kept.
 */
export async function addReaction(
  caller: Caller,
  id: string | undefined,
  commentId: string,
  emoji: string,
): Promise<Reaction | null> {
  const comment = await db.query.comments.findFirst({ where: eq(comments.id, commentId) });
  if (!comment) throw new NotFoundError("Comment");
  await authorizePage(caller, comment.pageId, "comment");
  const [reaction] = await db
    .insert(commentReactions)
    .values({
      ...(id && { id }),
      commentId,
      pageId: comment.pageId,
      workspaceId: comment.workspaceId,
      peopleId: authorId(caller),
      emoji: emojiOf(emoji),
    })
    .onConflictDoNothing()
    .returning();
  return reaction ?? null;
}

/** Takes the caller's own reaction off, by its id or by comment and emoji; one already gone is no error. */
export async function removeReaction(caller: Caller, which: string | { commentId: string; emoji: string }) {
  const where =
    typeof which === "string"
      ? eq(commentReactions.id, which)
      : and(
          eq(commentReactions.commentId, which.commentId),
          eq(commentReactions.peopleId, authorId(caller)),
          eq(commentReactions.emoji, which.emoji),
        );
  const reaction = await db.query.commentReactions.findFirst({ where });
  if (!reaction) return;
  if (reaction.peopleId !== authorId(caller)) throw new ForbiddenError("Only who reacted takes a reaction off");
  await db.delete(commentReactions).where(eq(commentReactions.id, reaction.id));
}

/** The reactions on some comments, by comment: each emoji once, with who put it there (People URNs), oldest first. */
export async function reactionsOf(commentIds: readonly string[]) {
  const out = new Map<string, { emoji: string; people: string[] }[]>();
  if (!commentIds.length) return out;
  const rows = await db
    .select()
    .from(commentReactions)
    .where(inArray(commentReactions.commentId, [...commentIds]))
    .orderBy(asc(commentReactions.createdAt));
  for (const row of rows) {
    const list = out.get(row.commentId) ?? [];
    const entry = list.find((r) => r.emoji === row.emoji);
    if (entry) entry.people.push(personUrl(row.peopleId));
    else list.push({ emoji: row.emoji, people: [personUrl(row.peopleId)] });
    out.set(row.commentId, list);
  }
  return out;
}
