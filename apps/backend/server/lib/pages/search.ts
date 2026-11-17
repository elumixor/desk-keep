import { and, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { db } from "~/db";
import { pages } from "~/db/schema";
import { type SearchBy, searchesContent, searchesNames, searchNames } from "~/model/search";
import { pageUrl } from "~/model/urn";
import type { ArchivedMode } from "~/model/views";
import { inScope, type Scope, scopeEmpty, scopeIn, scopeOf } from "../access";
import type { Caller } from "../auth/caller";
import { authorizeWorkspace } from "../permissions";
import { uuidList } from "./subtree";

const WORD = /[\p{L}\p{N}]+/gu;
export const SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;

/** Words a question is made of that say nothing about what it is after; dropped when any word matches is enough. */
const FILLER = new Set(
  (
    "a an and are as at be by can do does for from has have how i in is it its me my of on or our should so " +
    "that the their there this to was we what when where which who why will with you your"
  ).split(" "),
);

/** `ts_headline` marks the matched words in Markdown bold, which an assistant and the palette both read. */
const HEADLINE = 'StartSel=**, StopSel=**, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "';

interface Hit extends Record<string, unknown> {
  id: string;
  title: string;
  icon: string | null;
  workspace_id: string;
  parent_id: string | null;
  updated_at: string;
  rank: number;
  snippet: string | null;
  /** The title's characters a search by name matched. */
  matches?: readonly number[];
}

/**
 * What rules a title out before it is matched fuzzily: a match has every letter and digit of the query in it, so a
 * title lacking one of the query's ASCII ones goes. Titles with other characters (which the matcher folds: "é" is "e")
 * and empty ones ("Untitled") are always kept.
 */
function nameMayMatch(query: string) {
  const letters = [...new Set(query.toLowerCase().match(/[a-z0-9]/g) ?? [])];
  if (!letters.length) return undefined;
  const all = letters.map((c) => sql`lower(${pages.title}) like ${`%${c}%`}`);
  return sql`(${pages.title} = '' or ${pages.title} ~ '[^[:ascii:]]' or (${sql.join(all, sql` and `)}))`;
}

/** Which archived pages a search keeps (`p` is the page's alias in raw SQL). */
const archivedWhere = (mode: ArchivedMode): SQL | undefined =>
  mode === "include" ? undefined : mode === "only" ? isNotNull(pages.archivedAt) : isNull(pages.archivedAt);
const archivedRaw = (mode: ArchivedMode) =>
  mode === "include" ? sql`` : mode === "only" ? sql`and p.archived_at is not null` : sql`and p.archived_at is null`;

/** Pages named like the query, best first: every title the caller can read, matched as the device matches them. */
async function byName(scope: Scope, query: string, limit: number, archived: ArchivedMode): Promise<Hit[]> {
  if (scopeEmpty(scope)) return [];
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      icon: pages.icon,
      workspaceId: pages.workspaceId,
      parentId: pages.parentId,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(and(inScope(scope), isNull(pages.deletedAt), archivedWhere(archived), nameMayMatch(query)));
  return searchNames(rows, query, limit).map(({ page, score, matches }) => ({
    id: page.id,
    title: page.title,
    icon: page.icon,
    workspace_id: page.workspaceId ?? page.id,
    parent_id: page.parentId,
    updated_at: page.updatedAt.toISOString(),
    rank: score,
    snippet: null,
    matches,
  }));
}

/** Ranked full-text search over titles, headings, bodies and property text, with the passage that matched. */
async function byContent(
  scope: Scope,
  query: string,
  exclude: readonly string[],
  limit: number,
  archived: ArchivedMode,
) {
  const words = [...new Set(query.toLowerCase().match(WORD) ?? [])];
  if (!words.length) return [];
  const all = words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(" & ");
  const hits = await run(scope, all, exclude, limit, archived);
  if (hits.length < limit && words.length > 1) {
    const meaningful = words.filter((w) => !FILLER.has(w));
    const any = (meaningful.length ? meaningful : words).map((w) => `${w}:*`).join(" | ");
    hits.push(...(await run(scope, any, [...exclude, ...hits.map((h) => h.id)], limit - hits.length, archived)));
  }
  return hits;
}

async function run(scope: Scope, tsquery: string, exclude: readonly string[], limit: number, archived: ArchivedMode) {
  if (scopeEmpty(scope) || !tsquery) return [];
  const skip = exclude.length ? sql`and p.id not in (${uuidList(exclude)})` : sql``;
  // A page named by the words comes first, however little its body says; then title (A) over headings (B) over the
  // rest (C), and the newer page first between equals.
  return [
    ...(await db.execute<Hit>(sql`
      select p.id, p.title, p.icon, p.workspace_id, p.parent_id, p.updated_at,
        ts_rank(p.search, q) as rank,
        ts_headline('simple', p.text, q, ${HEADLINE}) as snippet
      from page p, to_tsquery('simple', ${tsquery}) q
      where ${inScope(scope, "p")} and p.deleted_at is null ${archivedRaw(archived)} and p.search @@ q ${skip}
      order by to_tsvector('simple', p.title) @@ q desc, rank desc, p.updated_at desc
      limit ${limit}`)),
  ];
}

/** Every hit's ancestors, root first, in one walk. */
async function paths(hits: readonly Hit[]) {
  const out = new Map<string, { id: string; title: string }[]>();
  if (!hits.length) return out;
  const rows = await db.execute<{ hit: string; id: string; title: string; depth: number }>(sql`
    with recursive up as (
      select h.id as hit, p.id, p.parent_id, p.title, 0 as depth from page h join page p on p.id = h.parent_id where h.id in (${uuidList(hits.map((h) => h.id))})
      union all select up.hit, p.id, p.parent_id, p.title, up.depth + 1 from page p join up on p.id = up.parent_id where up.depth < 64
    ) select hit, id, title, depth from up order by hit, depth desc`);
  for (const row of rows)
    out.set(row.hit, [...(out.get(row.hit) ?? []), { id: row.id, title: row.title || "Untitled" }]);
  return out;
}

/** A visitor's path starts at the share they reach the hit through; a member's is the whole of it. */
function visible(scope: Scope, workspaceId: string, path: readonly { id: string; title: string }[]) {
  if (scope.workspaceIds.includes(workspaceId)) return path;
  const top = path.findIndex((p) => scope.shareRoots.some((r) => r.pageId === p.id));
  return top === -1 ? [] : path.slice(top);
}

interface SearchOptions {
  /** One workspace; every workspace the caller can see when left out. */
  readonly workspaceId?: string;
  readonly query: string;
  /** How many of each kind. */
  readonly limit?: number;
  readonly by?: SearchBy;
  /** Archived pages left out (the default), found too, or alone. */
  readonly archived?: ArchivedMode;
}

/**
 * Pages by name, then by content: the titles matched fuzzily first, then the pages whose text holds the words (every
 * word, the last as a prefix, for typing; any meaningful one when that finds too little), without the ones named.
 */
export async function search(
  caller: Caller,
  { workspaceId, query, limit = SEARCH_LIMIT, by = "both", archived = "exclude" }: SearchOptions,
) {
  if (workspaceId) await authorizeWorkspace(caller, workspaceId, "read", { visitor: true });
  const everything = await scopeOf(caller.person.id);
  const scope = workspaceId ? scopeIn(everything, workspaceId) : everything;
  const named = searchesNames(by) ? await byName(scope, query, limit, archived) : [];
  const said = searchesContent(by)
    ? await byContent(
        scope,
        query,
        named.map((h) => h.id),
        limit,
        archived,
      )
    : [];
  const hits = [...named, ...said];
  const pathOf = await paths(hits);
  return hits.map((hit) => {
    const full = pathOf.get(hit.id) ?? [];
    const path = visible(scope, hit.workspace_id, full).map((p) => p.title);
    return {
      id: hit.id,
      url: pageUrl(hit.id),
      title: hit.title,
      icon: hit.icon,
      /** Found by its title, or by what it says. */
      match: hit.matches ? ("name" as const) : ("content" as const),
      /** The title's characters the query matched, for a match by name. */
      matches: hit.matches ?? null,
      /** Ancestors' titles from the workspace down to the parent. */
      path,
      parentTitle: path.at(-1) ?? null,
      workspace: {
        id: hit.workspace_id,
        title: (hit.workspace_id === hit.id ? hit.title : full[0]?.title) ?? "",
      },
      /** The passage that matched, for a match by content. */
      snippet: hit.snippet,
      rank: Number(hit.rank),
      updatedAt: new Date(hit.updated_at).toISOString(),
    };
  });
}
