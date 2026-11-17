import { desc, eq } from "drizzle-orm";
import type { Tx } from "~/db";
import { pageVersions } from "~/db/schema";
import { changedNothing, type Snapshot, snapshotOf, summarize } from "~/model/history";
import { authorId, type Caller } from "../auth/caller";
import type { PageWithBody as Page } from "../permissions";

/** One author's edits within this long of their previous edit belong to the same version. */
const SESSION_MS = 10 * 60 * 1000;

/**
 * Records what a write left the page as. An author still editing grows their latest version instead of starting one;
 * a page that predates history first gets a version for how it was, so the first change made has something to show.
 * A restore always starts a version of its own, so the edits before it stay in the history.
 */
export async function recordVersion(
  tx: Tx,
  caller: Caller,
  before: Page | null,
  after: Snapshot & { readonly id: string },
  restoredFrom?: Date,
) {
  const pageId = after.id;
  const [latest, previous] = await tx
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.createdAt))
    .limit(2);
  const author = { authorId: authorId(caller) };
  const now = new Date();
  const continuing =
    !restoredFrom &&
    latest?.authorId === author.authorId &&
    !latest.changes.restoredFrom &&
    now.getTime() - latest.editedAt.getTime() < SESSION_MS;

  if (continuing) {
    const changes = summarize(previous ? snapshotOf(previous) : null, after);
    // Edits that undid themselves leave nothing to keep.
    if (changedNothing(changes)) await tx.delete(pageVersions).where(eq(pageVersions.id, latest.id));
    else
      await tx
        .update(pageVersions)
        .set({ ...snapshotOf(after), changes, editedAt: now })
        .where(eq(pageVersions.id, latest.id));
    return;
  }

  let base = latest ? snapshotOf(latest) : null;
  if (!latest && before) {
    base = snapshotOf(before);
    await tx.insert(pageVersions).values({
      pageId,
      ...base,
      changes: summarize(null, base),
      createdAt: before.updatedAt,
      editedAt: before.updatedAt,
    });
  }
  const changes = summarize(base, after);
  if (changedNothing(changes)) return;
  await tx.insert(pageVersions).values({
    pageId,
    ...author,
    ...snapshotOf(after),
    changes: restoredFrom ? { ...changes, restoredFrom: restoredFrom.toISOString() } : changes,
    createdAt: now,
    editedAt: now,
  });
}
