import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Snapshot } from "../../model/history";
import { type KeepEvent, NOTIFICATION_TYPES, type NotificationData } from "../../model/watch";
import { pages, webhooks } from "./pages";

export const notificationTypeEnum = pgEnum("notification_type", NOTIFICATION_TYPES);
export const deliveryStateEnum = pgEnum("delivery_state", ["pending", "sent", "failed"]);

/**
 * Somebody's inbox entry (`recipient` and `actor` are People ids), and its delivery to People (an outbox: `state`,
 * `attempts`, `next_attempt_at`). A watch's changes within its window are merged into one row (`coalesce_key`,
 * `window_ends_at`), told against the page as it was before the first of them (`base`).
 */
export const notifications = pgTable(
  "notification",
  {
    id: uuid().primaryKey().defaultRandom(),
    recipient: uuid().notNull(),
    type: notificationTypeEnum().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    /** No FK: the notification outlives the comment. */
    commentId: uuid("comment_id"),
    actor: uuid(),
    /** A watch's tag (watch only). */
    client: text(),
    title: text().notNull(),
    text: text(),
    url: text().notNull(),
    data: jsonb().$type<NotificationData>().notNull(),
    base: jsonb().$type<Snapshot>(),
    coalesceKey: text("coalesce_key"),
    windowEndsAt: timestamp("window_ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    state: deliveryStateEnum().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_recipient").on(t.recipient, t.syncedAt),
    index("notification_due").on(t.nextAttemptAt).where(sql`${t.state} = 'pending'`),
    index("notification_coalesce").on(t.coalesceKey, t.windowEndsAt).where(sql`${t.coalesceKey} is not null`),
  ],
);

/** A notification deleted outright (undone edits, a purged page, retention), so its recipient's devices drop it. */
export const notificationTombstones = pgTable(
  "notification_tombstone",
  {
    id: uuid().primaryKey(),
    recipient: uuid().notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_tombstone_recipient").on(t.recipient, t.syncedAt)],
);

/**
 * A page somebody (a People id) watches, explicitly. A person's own has no client; an assistant's thread tags its
 * own (`pai:thread/<id>`). Unwatching stamps `deleted_at`, so their devices learn it.
 */
export const pageWatches = pgTable(
  "page_watch",
  {
    id: uuid().primaryKey().defaultRandom(),
    peopleId: uuid("people_id").notNull(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    client: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("page_watch_unique").on(t.peopleId, t.pageId, t.client).nullsNotDistinct(),
    index("page_watch_page").on(t.pageId),
    index("page_watch_person").on(t.peopleId, t.syncedAt),
  ],
);

/** One event to one hook, sent from the outbox with retries; `event.id` is shared by every hook it goes to. */
export const webhookDeliveries = pgTable(
  "webhook_delivery",
  {
    id: uuid().primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: jsonb().$type<KeepEvent>().notNull(),
    state: deliveryStateEnum().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_delivery_due").on(t.nextAttemptAt).where(sql`${t.state} = 'pending'`),
    index("webhook_delivery_hook").on(t.webhookId, t.createdAt),
  ],
);
