import { index, pgEnum, pgTable, primaryKey, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { SHARE_ROLES } from "../../model/access";
import { pages } from "./pages";
import { people } from "./people";

export const shareRoleEnum = pgEnum("share_role", SHARE_ROLES);

/**
 * A page (and everything under it) shared with an account, as `role`: view, comment, edit or full (also share it on
 * and trash it). The nearest share up a page's ancestry is what it gives there; a workspace role can only raise it.
 * `workspaceId` is the page's workspace (`coalesce(workspace_id, id)`), `syncedAt` stamped by a trigger.
 */
export const pageShares = pgTable(
  "page_share",
  {
    id: uuid().primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: shareRoleEnum().notNull(),
    invitedBy: uuid("invited_by").references(() => people.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("page_share_page_person").on(t.pageId, t.personId),
    index("page_share_person").on(t.personId, t.workspaceId),
    index("page_share_workspace").on(t.workspaceId),
  ],
);

/**
 * A subtree an account may no longer hold (a share revoked, a membership ended, a page moved out of a share): its
 * devices' next pull takes off whatever under it the account can no longer read. No FK on the page: it may be purged.
 */
export const syncRevocations = pgTable(
  "sync_revocation",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.pageId] }), index("sync_revocation_person").on(t.personId, t.syncedAt)],
);
