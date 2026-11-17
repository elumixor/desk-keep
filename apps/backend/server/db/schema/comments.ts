import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { pages } from "./pages";

/**
 * A comment on a page, shown under its properties. `workspaceId` and the author are written by the server from the
 * page and the caller, never taken from a client. Comments are flat: a reply names the comment it answers
 * (`replyTo`, cleared when that one goes), which it quotes.
 */
export const comments = pgTable(
  "comment",
  {
    id: uuid().primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    /** The author's People person id, as `page.created_by`. */
    authorId: uuid("author_id").notNull(),
    /** The comment on the same page this one answers. */
    replyTo: uuid("reply_to").references((): AnyPgColumn => comments.id, { onDelete: "set null" }),
    body: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comment_workspace").on(t.workspaceId, t.syncedAt),
    index("comment_page").on(t.pageId, t.createdAt),
    index("comment_reply_to").on(t.replyTo),
  ],
);

/** An emoji somebody put on a comment: once per person and emoji. Its page and workspace are the comment's. */
export const commentReactions = pgTable(
  "comment_reaction",
  {
    id: uuid().primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    /** Who reacted: a People person id, as a comment's author. */
    peopleId: uuid("people_id").notNull(),
    emoji: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("comment_reaction_unique").on(t.commentId, t.peopleId, t.emoji),
    index("comment_reaction_workspace").on(t.workspaceId, t.syncedAt),
    index("comment_reaction_comment").on(t.commentId),
  ],
);
