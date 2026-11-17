import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "~/db";
import { pages } from "~/db/schema";
import type { Caller } from "../auth/caller";
import { ApiError } from "../http/api-error";
import { authorizePage } from "../permissions";

/**
 * Archiving puts a page away without trashing it: `archived_at` is stamped and the page leaves the tree, views (unless
 * one shows archived pages) and `find_pages` (unless asked), yet stays on devices, read by id, found by a search that
 * includes archived pages, and comes back with `archived: false`. It is a quiet write: no version, notification or
 * webhook; the sync carries it (`synced_at` is stamped by the trigger). Only the page itself is stamped.
 */
export async function setArchived(caller: Caller, id: string, archived: boolean) {
  const page = await authorizePage(caller, id, "write");
  if (!page.parentId) throw new ApiError("A workspace cannot be archived");
  if (page.deletedAt) throw new ApiError("That page is in the trash");
  if (!!page.archivedAt === archived) return page;
  const [row] = await db
    .update(pages)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(pages.id, id))
    .returning();
  return row;
}

/** Archives pages for Keep itself (a view's cleanup rule): no caller, so no rights to check. Answers how many. */
export async function archivePages(ids: readonly string[]) {
  if (!ids.length) return 0;
  const rows = await db
    .update(pages)
    .set({ archivedAt: new Date() })
    .where(and(inArray(pages.id, [...ids]), isNull(pages.archivedAt), isNull(pages.deletedAt)))
    .returning({ id: pages.id });
  return rows.length;
}
