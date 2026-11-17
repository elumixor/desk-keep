import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "~/db";
import { pages, pageVersions, views } from "~/db/schema";
import { type Cleanup, cleanupFilter, type Filter, matches, type Row, selectsNothing } from "~/model/views";
import { archivePages } from "./pages/archive";
import { runQuery } from "./views";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Since when each row has met the rule's condition: the last edit of the oldest version, in the unbroken run of its
 * newest versions, whose value meets it (`page_version` keeps every property's value per editing session); the row's
 * last update when it has no history.
 */
async function heldSince(rows: readonly Row[], condition: Filter) {
  const out = new Map<string, number>();
  if (!rows.length) return out;
  const versions = await db
    .select({
      pageId: pageVersions.pageId,
      properties: pageVersions.properties,
      schema: pageVersions.schema,
      editedAt: pageVersions.editedAt,
    })
    .from(pageVersions)
    .where(
      inArray(
        pageVersions.pageId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(pageVersions.pageId), desc(pageVersions.createdAt));
  const byPage = new Map<string, typeof versions>();
  for (const version of versions) byPage.set(version.pageId, [...(byPage.get(version.pageId) ?? []), version]);
  for (const row of rows) {
    let since = row.updatedAt ? new Date(row.updatedAt).getTime() : Date.now();
    for (const version of byPage.get(row.id) ?? []) {
      if (!matches({ ...row, properties: version.properties, schema: version.schema }, condition)) break;
      since = version.editedAt.getTime();
    }
    out.set(row.id, since);
  }
  return out;
}

/** Archives what one view's rule asks for now; answers the pages archived. */
async function cleanView(view: typeof views.$inferSelect & { cleanup: Cleanup }, workspaceId: string) {
  if (selectsNothing(view)) return [];
  const condition = cleanupFilter(view.cleanup);
  const { rows } = await runQuery(workspaceId, { ...view, showArchived: false });
  const meeting = rows.filter((row) => matches(row, condition));
  const since = await heldSince(meeting, condition);
  const cutoff = Date.now() - view.cleanup.days * DAY_MS;
  const due = meeting.filter((row) => (since.get(row.id) ?? Date.now()) <= cutoff);
  await archivePages(due.map((row) => row.id));
  return due.map((row) => ({ id: row.id, title: row.title }));
}

/**
 * Runs views' cleanup rules ("archive pages in this view when Status is Done for 7 days"): every view's once a day
 * (`plugins/outbox.ts`), one view's when its rule is saved. As Keep, over every page the view
 * selects; a view in the trash cleans nothing.
 */
export async function runCleanup(viewId?: string) {
  const rows = await db
    .select({ view: views, workspaceId: pages.workspaceId })
    .from(views)
    .innerJoin(pages, eq(pages.id, views.id))
    .where(and(isNotNull(views.cleanup), isNull(pages.deletedAt), viewId ? eq(views.id, viewId) : undefined));
  const archived: { id: string; title: string }[] = [];
  for (const { view, workspaceId } of rows)
    if (view.cleanup && workspaceId)
      archived.push(...(await cleanView({ ...view, cleanup: view.cleanup }, workspaceId)));
  return { archived: archived.length, pages: archived };
}

/** After a view's settings are written: a rule just set (or changed) runs at once. */
export async function cleanupSaved(viewId: string, cleanup: Cleanup | null | undefined) {
  if (!cleanup) return null;
  try {
    return await runCleanup(viewId);
  } catch (error) {
    console.warn(`[cleanup] view ${viewId} failed: ${(error as Error).message}`);
    return null;
  }
}
