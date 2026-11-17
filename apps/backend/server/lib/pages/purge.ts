import { type SQL, sql } from "drizzle-orm";
import { db } from "~/db";
import { notifications, notificationTombstones, pages, webhookDeliveries } from "~/db/schema";
import type { Caller } from "../auth/caller";
import { ApiError } from "../http/api-error";
import { authorizePage } from "../permissions";

/** How long a page stays in the trash before it is deleted for good. */
const TRASH_RETENTION_DAYS = 30;

/** Deletes pages outright, everything under them going with them; resolves with how many `roots` matched. */
async function erase(roots: SQL) {
  // A view's query goes with its node (a cascade); devices forgot it when the node went to the trash.
  const gone = await db.delete(pages).where(roots).returning({ id: pages.id });
  return gone.length;
}

/** Deletes a page in the trash for good, with everything under it. There is no undoing it. */
export async function purgePage(caller: Caller, id: string) {
  const page = await authorizePage(caller, id, "delete");
  if (!page.parentId) throw new ApiError("Delete a workspace from its settings");
  if (!page.deletedAt) throw new ApiError("Only a page in the trash can be deleted for good");
  await erase(sql`id = ${id}`);
  return { id };
}

/** Read notifications are kept this long, and what devices are told of deleted ones; delivered webhook events (and failed ones) this long. */
const READ_RETENTION_DAYS = 90;
const DELIVERY_RETENTION_DAYS = 14;

/** Deletes for good every page that has been in the trash longer than it keeps them, and old outbox rows. */
export async function purgeExpiredTrash() {
  const purged = await erase(
    sql`parent_id is not null and deleted_at < now() - make_interval(days => ${TRASH_RETENTION_DAYS})`,
  );
  const read = await db
    .delete(notifications)
    .where(sql`read_at < now() - make_interval(days => ${READ_RETENTION_DAYS})`)
    .returning({ id: notifications.id });
  const delivered = await db
    .delete(webhookDeliveries)
    .where(sql`state <> 'pending' and created_at < now() - make_interval(days => ${DELIVERY_RETENTION_DAYS})`)
    .returning({ id: webhookDeliveries.id });
  await db.delete(notificationTombstones).where(sql`synced_at < now() - make_interval(days => ${READ_RETENTION_DAYS})`);
  return { purged, notifications: read.length, deliveries: delivered.length };
}
