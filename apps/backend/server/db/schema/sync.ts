import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * What the app's sync (`lib/sync`) needs besides the rows themselves. Every write to a page, view or trait stamps its
 * `synced_at` (a trigger, so no write path can forget); a view or trait deleted outright leaves a row here, so a
 * client that held it learns it is gone. Pages are never deleted outright: their tombstone is `deleted_at`.
 */
export const tombstones = pgTable(
  "sync_tombstone",
  {
    model: text().notNull(),
    id: uuid().notNull(),
    workspaceId: uuid("workspace_id"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.model, t.id] }), index("sync_tombstone_workspace").on(t.workspaceId, t.syncedAt)],
);

/** Writes a client sent that were carried out, by their author, so a retry of one is answered without doing it twice. */
export const mutations = pgTable(
  "sync_mutation",
  {
    authorId: uuid("author_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.authorId, t.mutationId] })],
);
