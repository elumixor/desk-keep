import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import { notifications } from "~/db/schema";
import { commentUrn, pageUrn, personUrn } from "~/model/urn";
import { authorId, type Caller } from "../auth/caller";
import type { PeopleNotification } from "../people-api/client";

export type NotificationRow = typeof notifications.$inferSelect;

/** A notification as People takes it (and an assistant reads it): the Keep → People contract. */
export function toNotification(row: NotificationRow): PeopleNotification {
  return {
    id: row.id,
    to: row.recipient,
    source: "keep",
    type: row.type,
    title: row.title,
    ...(row.text && { text: row.text }),
    url: row.url,
    subject: pageUrn(row.pageId),
    ...(row.actor && { actor: personUrn(row.actor) }),
    // Only a watch carries a client: its own tag, so the watcher's thread gets it, never the writer's.
    ...(row.type === "watch" && row.client && { client: row.client }),
    createdAt: row.createdAt.toISOString(),
    data: {
      ...row.data,
      workspace: pageUrn(row.workspaceId),
      page: pageUrn(row.pageId),
      ...(row.commentId && { comment: commentUrn(row.commentId) }),
    },
  };
}

const LIST_LIMIT = 50;

/** The caller's notifications, newest first: unread only by default, on one page if asked. */
export async function listInbox(caller: Caller, opts: { unreadOnly?: boolean; pageId?: string; limit?: number } = {}) {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipient, authorId(caller)),
        opts.unreadOnly === false ? undefined : isNull(notifications.readAt),
        opts.pageId ? eq(notifications.pageId, opts.pageId) : undefined,
      ),
    )
    .orderBy(desc(notifications.updatedAt))
    .limit(opts.limit ?? LIST_LIMIT);
  return rows.map((row) => ({ ...toNotification(row), read: row.readAt !== null }));
}

/** Marks some of the caller's notifications read (or every unread one). */
export async function markRead(caller: Caller, ids: readonly string[] | "all") {
  if (ids !== "all" && !ids.length) return { read: 0 };
  const marked = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.recipient, authorId(caller)),
        isNull(notifications.readAt),
        ids === "all" ? undefined : inArray(notifications.id, [...ids]),
      ),
    )
    .returning({ id: notifications.id });
  return { read: marked.length };
}
