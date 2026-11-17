import { and, eq, type SQL, sql } from "drizzle-orm";
import { db, type Tx } from "~/db";
import { memberships, pageShares, type Role } from "~/db/schema";
import { type Access, accessOf, type ShareRole } from "~/model/access";
import { subtreeOfMany, uuidList } from "./pages/subtree";

type Query = typeof db | Tx;

/** The page with its ancestors, nearest first, each with its workspace: what every access check walks. */
const upFrom = (pageId: string) => sql`
  with recursive up as (
    select p.id, p.parent_id, coalesce(p.workspace_id, p.id) as ws, 0 as depth from page p where p.id = ${pageId}
    union all select p.id, p.parent_id, up.ws, up.depth + 1 from page p join up on p.id = up.parent_id where up.depth < 64
  )`;

/**
 * An account's access to a page: the better of its role in the page's workspace and the share nearest the page up its
 * ancestry (a nearer share wins over one further up). `none` for a page that does not exist. `exceptShare` leaves
 * one share out: what the account would have without it.
 */
export async function accessFor(q: Query, accountId: string, pageId: string, exceptShare?: string): Promise<Access> {
  const except = exceptShare ? sql`and s.id <> ${exceptShare}` : sql``;
  const [row] = await q.execute<{ role: Role | null; share: ShareRole | null }>(sql`
    ${upFrom(pageId)}
    select
      (select m.role from membership m where m.person_id = ${accountId} and m.workspace_id = (select ws from up where depth = 0)) as role,
      (select s.role from up join page_share s on s.page_id = up.id and s.person_id = ${accountId} ${except} order by up.depth limit 1) as share`);
  return accessOf(row?.role ?? null, row?.share ?? null);
}

/** Of some People ids, the ones whose account may read the page: a member of its workspace, or shared it or above. */
export async function readersAmong(pageId: string, peopleIds: readonly string[], q: Query = db): Promise<Set<string>> {
  if (!peopleIds.length) return new Set();
  const rows = await q.execute<{ people_id: string }>(sql`
    ${upFrom(pageId)}
    select a.people_id from person a where a.people_id in (${uuidList(peopleIds)}) and (
      exists (select 1 from membership m where m.person_id = a.id and m.workspace_id = (select ws from up where depth = 0))
      or exists (select 1 from up join page_share s on s.page_id = up.id and s.person_id = a.id))`);
  return new Set(rows.map((r) => r.people_id));
}

/**
 * Of some pages, the ones whoever reads the page may read too: in its workspace, and reached by every share that
 * reaches it for somebody who is no member there. What a formula stored on the page, seen by all its readers, may read.
 */
export async function readableWith(q: Query, pageId: string, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await q.execute<{ id: string }>(sql`
    with recursive up as (
      select p.id, p.parent_id, coalesce(p.workspace_id, p.id) as ws, 0 as depth from page p where p.id = ${pageId}
      union all select p.id, p.parent_id, up.ws, up.depth + 1 from page p join up on p.id = up.parent_id where up.depth < 64
    ), holders as (
      select distinct s.person_id from up join page_share s on s.page_id = up.id
      where not exists (select 1 from membership m where m.person_id = s.person_id and m.workspace_id = (select ws from up where depth = 0))
    ), other as (
      select p.id as target, p.id, p.parent_id, 0 as depth from page p
      where p.id in (${uuidList(ids)}) and coalesce(p.workspace_id, p.id) = (select ws from up where depth = 0)
      union all select o.target, p.id, p.parent_id, o.depth + 1 from page p join other o on p.id = o.parent_id where o.depth < 64
    )
    select distinct o.target as id from other o where not exists (
      select 1 from holders h where not exists (
        select 1 from other a join page_share s on s.page_id = a.id where a.target = o.target and s.person_id = h.person_id))`);
  return new Set(rows.map((r) => r.id));
}

/** Whether the person (a People id) may read the page: what a notification checks before it is sent. */
export const canReadAs = async (q: Query, peopleId: string, pageId: string) =>
  (await readersAmong(pageId, [peopleId], q)).has(peopleId);

/** A share an account holds in a workspace it is no member of: the root of a subtree its devices hold. */
export interface ShareRoot {
  readonly pageId: string;
  readonly workspaceId: string;
  readonly role: ShareRole;
  readonly syncedAt: Date;
}

/** Everything an account can read, as the sync and search ask it. */
export interface Scope {
  readonly accountId: string;
  /** The workspaces it is a member of, whole. */
  readonly workspaceIds: readonly string[];
  readonly memberships: readonly { readonly workspaceId: string; readonly syncedAt: Date }[];
  /** Its shares outside those workspaces. */
  readonly shareRoots: readonly ShareRoot[];
  /** The workspaces it holds shares in only. */
  readonly visitorWorkspaceIds: readonly string[];
}

export async function scopeOf(accountId: string): Promise<Scope> {
  const [joined, shares] = await Promise.all([
    db
      .select({ workspaceId: memberships.workspaceId, syncedAt: memberships.syncedAt })
      .from(memberships)
      .where(eq(memberships.personId, accountId)),
    db
      .select({
        pageId: pageShares.pageId,
        workspaceId: pageShares.workspaceId,
        role: pageShares.role,
        syncedAt: pageShares.syncedAt,
      })
      .from(pageShares)
      .where(eq(pageShares.personId, accountId)),
  ]);
  const workspaceIds = joined.map((m) => m.workspaceId);
  const shareRoots = shares.filter((s) => !workspaceIds.includes(s.workspaceId));
  return {
    accountId,
    workspaceIds,
    memberships: joined,
    shareRoots,
    visitorWorkspaceIds: [...new Set(shareRoots.map((s) => s.workspaceId))],
  };
}

/** Whether a scope reaches anything at all. */
export const scopeEmpty = (scope: Scope) => !scope.workspaceIds.length && !scope.shareRoots.length;

/**
 * The rows of `alias` (a page) a scope reaches: its whole member workspaces, and the subtrees shared with it. The outer
 * row is named explicitly, as an interpolated column would render unqualified inside the subquery.
 */
export function inScope(scope: Scope, alias = "page"): SQL {
  const row = sql.raw(`"${alias}"`);
  const parts: SQL[] = [];
  if (scope.workspaceIds.length) parts.push(sql`${row}."workspace_id" in (${uuidList(scope.workspaceIds)})`);
  if (scope.shareRoots.length)
    parts.push(sql`${row}."id" in (${subtreeOfMany(scope.shareRoots.map((r) => r.pageId))})`);
  return parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;
}

/** A scope narrowed to one workspace: all of it for a member, its shared subtrees for a visitor. */
export const scopeIn = (scope: Scope, workspaceId: string): Scope => ({
  ...scope,
  workspaceIds: scope.workspaceIds.filter((id) => id === workspaceId),
  memberships: scope.memberships.filter((m) => m.workspaceId === workspaceId),
  shareRoots: scope.shareRoots.filter((r) => r.workspaceId === workspaceId),
  visitorWorkspaceIds: scope.visitorWorkspaceIds.filter((id) => id === workspaceId),
});

/** Whether an account holds a share in the workspace without being a member: it may read the workspace's metadata. */
export async function visits(accountId: string, workspaceId: string) {
  const share = await db.query.pageShares.findFirst({
    where: and(eq(pageShares.personId, accountId), eq(pageShares.workspaceId, workspaceId)),
    columns: { id: true },
  });
  return !!share;
}

/** Whether an account belongs anywhere yet: a membership or a share. */
export async function hasMembershipOrShare(accountId: string) {
  const [membership, share] = await Promise.all([
    db.query.memberships.findFirst({ where: eq(memberships.personId, accountId), columns: { role: true } }),
    db.query.pageShares.findFirst({ where: eq(pageShares.personId, accountId), columns: { id: true } }),
  ]);
  return !!membership || !!share;
}

/**
 * Who holds a share on the page or above it (accounts), but is no member of its workspace: the people a move of the
 * page out from under their share takes it from.
 */
export async function sharersAbove(q: Query, pageId: string): Promise<string[]> {
  const rows = await q.execute<{ person_id: string }>(sql`
    ${upFrom(pageId)}
    select distinct s.person_id from up join page_share s on s.page_id = up.id
    where not exists (select 1 from membership m where m.person_id = s.person_id and m.workspace_id = (select ws from up where depth = 0))`);
  return rows.map((r) => r.person_id);
}

/** What of a workspace an account reads when it is no member there (its shared subtrees), or null for a member. */
export async function visitorScope(accountId: string, workspaceId: string): Promise<Scope | null> {
  const scope = await scopeOf(accountId);
  return scope.workspaceIds.includes(workspaceId) ? null : scopeIn(scope, workspaceId);
}
