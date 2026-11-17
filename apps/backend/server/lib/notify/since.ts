import { and, asc, desc, eq, gt, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "~/db";
import { comments, notifications, pages, pageVersions } from "~/db/schema";
import { diffSnapshots, type Snapshot, snapshotOf } from "~/model/history";
import { pageUrl, UUID } from "~/model/urn";
import { pageChanges } from "~/model/watch";
import { authorId, type Caller } from "../auth/caller";
import { commentPayloads } from "../comments";
import { ApiError } from "../http/api-error";
import { readableProperties } from "../pages/readable";

const EMPTY: Snapshot = { title: "", icon: null, body: null, properties: {}, schema: [] };

/** The page as its history has it at `at`: the newest version edited by then (a version grows for ten minutes). */
async function versionAt(pageId: string, at: Date): Promise<Snapshot | null> {
  const [row] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), lte(pageVersions.editedAt, at)))
    .orderBy(desc(pageVersions.editedAt))
    .limit(1);
  return row ? snapshotOf(row) : null;
}

/**
 * Where a `since` cursor starts: one of the caller's own notifications on this page, or a time. A notification's
 * cursor includes its own instant: the comment or subpage that made it was written in the same transaction, at the
 * same `now()`.
 */
async function cursor(caller: Caller, pageId: string, since: string) {
  if (UUID.test(since)) {
    const row = await db.query.notifications.findFirst({
      where: and(
        eq(notifications.id, since),
        eq(notifications.recipient, authorId(caller)),
        eq(notifications.pageId, pageId),
      ),
    });
    if (!row) throw new ApiError("Unknown since cursor");
    return { from: row.createdAt, inclusive: true, base: row.base ?? (await versionAt(pageId, row.createdAt)) };
  }
  const from = new Date(since);
  if (Number.isNaN(from.getTime())) throw new ApiError("`since` is a notification's `data.since` or an ISO time");
  return { from, inclusive: false, base: await versionAt(pageId, from) };
}

/**
 * What changed on a page (that the caller reads) since a cursor: the lines a notification tells (`items`), the diff
 * of its title, body and properties, the comments written or edited since, and the subpages added since.
 */
export async function changesSince(caller: Caller, page: Snapshot & { readonly id: string }, since: string) {
  const { from, inclusive, base } = await cursor(caller, page.id, since);
  const newer = inclusive ? gte : gt;
  const now = snapshotOf(page);
  const diff = diffSnapshots(base, now, 2);
  const [written, added] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(and(eq(comments.pageId, page.id), or(newer(comments.createdAt, from), newer(comments.editedAt, from))))
      .orderBy(asc(comments.createdAt)),
    db
      .select({ id: pages.id, title: pages.title, kind: pages.kind })
      .from(pages)
      .where(and(eq(pages.parentId, page.id), newer(pages.createdAt, from), isNull(pages.deletedAt)))
      .orderBy(asc(pages.sort)),
  ]);
  return {
    since: from.toISOString(),
    items: pageChanges(base ?? EMPTY, now, readableProperties),
    title: base && base.title !== now.title ? { before: base.title, after: now.title } : null,
    body: diff.body.map((line) =>
      "skipped" in line
        ? `… ${line.skipped} unchanged`
        : `${line.change === "added" ? "+" : line.change === "removed" ? "-" : " "} ${line.text}`,
    ),
    properties: diff.properties.map((change) => ({
      name: change.name,
      before: change.before?.value ?? null,
      after: change.after?.value ?? null,
    })),
    comments: (await commentPayloads(written)).map(({ pageId: _, ...c }) => c),
    children: { added: added.map((c) => ({ ...c, url: pageUrl(c.id) })) },
  };
}
