import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "~/db";
import { pages, pageWatches } from "~/db/schema";
import { pageUrl, personUrl } from "~/model/urn";
import { canReadAs } from "../access";
import { authorId, type Caller } from "../auth/caller";
import { authorizePage } from "../permissions";

export type Watch = typeof pageWatches.$inferSelect;

/** The same client tag, a missing one matching only a missing one. */
const sameClient = (client: string | null) =>
  client === null ? isNull(pageWatches.client) : eq(pageWatches.client, client);

/**
 * The caller starts watching a page (again), under a client tag (`null`: the person themself). Watching needs being
 * able to read it; what they lose access to later stays watched, and silent.
 */
export async function watchPage(caller: Caller, pageId: string, client: string | null): Promise<Watch> {
  await authorizePage(caller, pageId, "read");
  const [row] = await db
    .insert(pageWatches)
    .values({ peopleId: authorId(caller), pageId, client })
    .onConflictDoUpdate({
      target: [pageWatches.peopleId, pageWatches.pageId, pageWatches.client],
      set: { deletedAt: null },
    })
    .returning();
  return row;
}

export async function unwatchPage(caller: Caller, pageId: string, client: string | null) {
  await db
    .update(pageWatches)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(pageWatches.peopleId, authorId(caller)),
        eq(pageWatches.pageId, pageId),
        sameClient(client),
        isNull(pageWatches.deletedAt),
      ),
    );
  return { pageId, client, watching: false };
}

/**
 * The caller's watches: under one client tag (`null`, the person's own), or every one (`"any"`). A page they no longer
 * read is listed without its title, so it can still be unwatched.
 */
export async function myWatches(caller: Caller, opts: { client: string | null | "any"; pageId?: string }) {
  const rows = await db
    .select({
      pageId: pageWatches.pageId,
      client: pageWatches.client,
      createdAt: pageWatches.createdAt,
      title: pages.title,
    })
    .from(pageWatches)
    .innerJoin(pages, eq(pages.id, pageWatches.pageId))
    .where(
      and(
        eq(pageWatches.peopleId, authorId(caller)),
        isNull(pageWatches.deletedAt),
        opts.client === "any" ? undefined : sameClient(opts.client),
        opts.pageId ? eq(pageWatches.pageId, opts.pageId) : undefined,
      ),
    )
    .orderBy(asc(pageWatches.createdAt));
  const me = authorId(caller);
  const readable = await Promise.all(rows.map((row) => canReadAs(db, me, row.pageId)));
  return rows.map((row, i) => ({ ...row, title: readable[i] ? row.title : null, url: pageUrl(row.pageId) }));
}

/** Who watches a page (any reader may ask): each person once, with whether they watch it themself and how many clients do. */
export async function pageWatchers(caller: Caller, pageId: string) {
  await authorizePage(caller, pageId, "read");
  const rows = await db
    .select({ peopleId: pageWatches.peopleId, client: pageWatches.client })
    .from(pageWatches)
    .where(and(eq(pageWatches.pageId, pageId), isNull(pageWatches.deletedAt)));
  const byPerson = new Map<string, { peopleId: string; url: string; watching: boolean; tagged: number }>();
  for (const row of rows) {
    const entry = byPerson.get(row.peopleId) ?? {
      peopleId: row.peopleId,
      url: personUrl(row.peopleId),
      watching: false,
      tagged: 0,
    };
    if (row.client === null) entry.watching = true;
    else entry.tagged++;
    byPerson.set(row.peopleId, entry);
  }
  return [...byPerson.values()];
}

/** The live watches of some pages: who a write to them tells. */
export async function watchersOf(tx: Tx, pageIds: readonly string[]): Promise<Watch[]> {
  if (!pageIds.length) return [];
  return await tx
    .select()
    .from(pageWatches)
    .where(and(inArray(pageWatches.pageId, [...new Set(pageIds)]), isNull(pageWatches.deletedAt)));
}
