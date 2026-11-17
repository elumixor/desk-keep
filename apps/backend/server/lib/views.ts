import { and, arrayContains, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import { pages, views } from "~/db/schema";
import { findProperty, type PropertyDefinition, type Schema } from "~/model/properties";
import { UUID } from "~/model/urn";
import {
  type ArchivedMode,
  archivedMode,
  type Filter,
  PARENT,
  placeOf,
  prefilledValues,
  type Sort,
  selectsNothing,
  TITLE,
  TRAIT,
  underFilters,
  type ViewKind,
  type ViewQuery,
  viewResult,
} from "~/model/views";
import { inScope, type Scope, visitorScope } from "./access";
import type { Caller } from "./auth/caller";
import { cleanupSaved } from "./cleanup";
import { ApiError, NotFoundError } from "./http/api-error";
import { sortKeys } from "./pages/formulas";
import { below } from "./pages/subtree";
import { createPage, deletePage, updatePage, type ViewConfig } from "./pages/write";
import { authorizePage, authorizeWorkspace, type Page } from "./permissions";
import { changeTrait, workspaceTraits } from "./traits";

export type View = typeof views.$inferSelect;

interface ViewInput extends ViewConfig {
  /** The id a client chose for a view it creates (`lib/sync`). */
  readonly id?: string;
  readonly name?: string;
  readonly icon?: string | null;
  readonly kind?: ViewKind;
  readonly filter?: readonly Filter[];
  readonly sort?: readonly Sort[];
}

const NAMES: Record<ViewKind, string> = { table: "Table", board: "Board", list: "List", timeline: "Timeline" };

/** A view node under a page: what it shows (`ViewConfig`), named after its layout unless named. */
export async function createView(caller: Caller, parentId: string, input: ViewInput) {
  const { id, name, icon, ...config } = input;
  const page = await createPage(caller, parentId, {
    id,
    kind: "view",
    title: name ?? NAMES[input.kind ?? "table"],
    icon: icon ?? null,
    view: config,
  });
  return { ...(await findView(page.id)), name: page.title };
}

async function findView(id: string) {
  const view = await db.query.views.findFirst({ where: eq(views.id, id) });
  if (!view) throw new NotFoundError("View");
  return view;
}

async function authorizeView(caller: Caller, id: string, action: "read" | "write") {
  const node = await authorizePage(caller, id, action);
  return { view: await findView(id), node };
}

export async function updateView(caller: Caller, id: string, input: ViewInput) {
  const { name, icon, id: _id, ...config } = input;
  await authorizeView(caller, id, "write");
  await updatePage(caller, id, { title: name, icon, view: config });
  await cleanupSaved(id, config.cleanup);
  return findView(id);
}

export async function deleteView(caller: Caller, id: string) {
  await authorizeView(caller, id, "write");
  await deletePage(caller, id);
  return { id };
}

const columns = {
  id: pages.id,
  parentId: pages.parentId,
  title: pages.title,
  icon: pages.icon,
  sort: pages.sort,
  properties: pages.properties,
  schema: pages.schema,
  traits: pages.traits,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
  archivedAt: pages.archivedAt,
} as const;

const archivedClause = (mode: ArchivedMode) =>
  mode === "include" ? undefined : mode === "only" ? isNotNull(pages.archivedAt) : isNull(pages.archivedAt);

const SPECIAL = new Set([TITLE, PARENT, TRAIT]);
const ASCII = /^[\x20-\x7e]+$/;
const likeEscaped = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * What the database can rule out before the filters run in JavaScript (`viewResult`), which stay the authority: a page
 * whose values hold an id ("Assignee contains <person>") has that id somewhere in its properties' text, a title that
 * contains some ASCII words has them in any case, and a page of a trait has it among its traits.
 */
function prefilters(query: Pick<ViewQuery, "filter">) {
  return query.filter.flatMap((f) => {
    const value = typeof f.value === "string" ? f.value : "";
    if (!value) return [];
    if (f.property === PARENT && f.op === "is") return [eq(pages.parentId, value)];
    if (f.property === TRAIT && f.op === "is") return [arrayContains(pages.traits, [value])];
    if (f.property === TITLE && f.op === "contains" && ASCII.test(value))
      return [sql`${pages.title} ilike ${`%${likeEscaped(value)}%`}`];
    if (!SPECIAL.has(f.property) && f.property[0] !== "$" && (f.op === "contains" || f.op === "is") && UUID.test(value))
      return [sql`${pages.properties}::text ilike ${`%${likeEscaped(value)}%`}`];
    return [];
  });
}

/**
 * The workspace's pages having all of the query's traits, under every page it keeps to being under, archived ones only
 * when it shows them; for a visitor, only those in its shared subtrees (`scope`). Filters the database can apply cheaply narrow it first (`prefilters`).
 */
function candidates(
  workspaceId: string,
  query: Pick<ViewQuery, "traits" | "filter" | "showArchived" | "archived">,
  scope: Scope | null,
) {
  const under = underFilters(query).map((id) => sql`${pages.id} in (${below(id)})`);
  return db
    .select(columns)
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        eq(pages.kind, "page"),
        isNull(pages.deletedAt),
        archivedClause(archivedMode(query)),
        sql`${pages.parentId} is not null`,
        query.traits.length ? arrayContains(pages.traits, [...query.traits]) : undefined,
        scope ? inScope(scope) : undefined,
        ...under,
        ...prefilters(query),
      ),
    );
}

/**
 * What a query shows: the pages having its traits its filters keep, in its order, and the columns they make: the
 * traits' properties first, then any other property a shown page has.
 */
export async function runQuery(workspaceId: string, query: ViewQuery, scope: Scope | null = null) {
  const [found, traits] = await Promise.all([candidates(workspaceId, query, scope), workspaceTraits(workspaceId)]);
  const keys = query.sortCode?.trim() ? await sortKeys(found, query.sortCode) : undefined;
  return viewResult(
    found.map((page) => ({
      ...page,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      archivedAt: page.archivedAt?.toISOString() ?? null,
    })),
    traits,
    query,
    keys && ((page) => keys.get(page.id)),
  );
}

/**
 * The pages a view shows, filtered and sorted on the server — what an assistant reads; `archived` overrides whether it
 * shows archived pages.
 */
export async function queryView(caller: Caller, viewId: string, archived?: ArchivedMode) {
  const { view, node } = await authorizeView(caller, viewId, "read");
  const workspaceId = node.workspaceId ?? node.id;
  const result = selectsNothing(view)
    ? viewResult([], [], view)
    : await runQuery(workspaceId, { ...view, archived }, await visitorScope(caller.person.id, workspaceId));
  return { view: { ...view, name: node.title }, ...result };
}

/** Where a page made in a view goes when none is said: the view's own choice, where its filters look, else the view. */
const defaultParent = (view: View) => view.newParent ?? placeOf(view) ?? view.id;

/**
 * A page made from a view, so it shows there: with the properties of the view's traits and the values its `is`
 * filters ask for, any values given on top (a board column's option, say), under `parentId` or the view's choice.
 */
export async function createInView(
  caller: Caller,
  viewId: string,
  input: { title?: string; properties?: Readonly<Record<string, unknown>>; parentId?: string },
) {
  const { view, columns, traits } = await queryView(caller, viewId);
  const properties = { ...prefilledValues(view, columns), ...input.properties };
  // A value for a column no trait brings is given its property on the new page.
  const fromTraits = traits.flatMap((t) => t.properties);
  const extra = Object.keys(properties).flatMap((name) => {
    const column = findProperty(columns, name);
    return column && !findProperty(fromTraits, name) ? [column] : [];
  });
  return createPage(caller, input.parentId ?? defaultParent(view), {
    title: input.title ?? "",
    traits: traits.map((t) => t.id),
    properties,
    addProperties: extra,
  });
}

/**
 * A property added from a view's column header: to the view's first trait, so every page having it gets it. A view
 * of no trait has nowhere to add one.
 */
export async function addViewProperty(caller: Caller, viewId: string, definition: PropertyDefinition) {
  const { view, node } = await authorizeView(caller, viewId, "write");
  const workspaceId = node.workspaceId ?? node.id;
  const all = await workspaceTraits(workspaceId);
  const trait = all.find((t) => t.id === view.traits[0]);
  if (!trait) throw new ApiError("Choose which trait this view shows before adding properties");
  const properties: Schema = [...trait.properties, definition];
  const changed = await db.transaction((tx) => changeTrait(tx, trait, { properties }));
  return { view, trait: changed.trait, refused: [] as string[] };
}

/** Views of a workspace (or under one page), named. */
export async function listViews(caller: Caller, workspaceId: string, under?: Page) {
  await authorizeWorkspace(caller, workspaceId, "read", { visitor: true });
  const scope = await visitorScope(caller.person.id, workspaceId);
  const rows = await db
    .select({ view: views, name: pages.title, parentId: pages.parentId })
    .from(views)
    .innerJoin(pages, eq(pages.id, views.id))
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        isNull(pages.deletedAt),
        scope ? inScope(scope) : undefined,
        under ? eq(pages.parentId, under.id) : undefined,
      ),
    );
  return rows.map((r) => ({ ...r.view, name: r.name, parentId: r.parentId }));
}
