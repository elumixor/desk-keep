import { and, arrayContains, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, type Tx } from "~/db";
import { pages, views } from "~/db/schema";
import { isSelect, type OptionChange, optionChange, withOptionChanges } from "~/model/options";
import {
  findProperty,
  InvalidPropertyError,
  keepValid,
  renameSchema,
  type Schema,
  schemaSchema,
} from "~/model/properties";
import { followTrait, inferTraits, renameInDefinition, retyped, type TraitChange, traitsOf } from "~/model/traits";
import { TEMPLATE_TITLE } from "~/model/views";
import { inScope, visitorScope } from "./access";
import type { Caller } from "./auth/caller";
import { ApiError, NotFoundError } from "./http/api-error";
import { transact, writesCommitted } from "./notify/outbox";
import { writeRows } from "./pages/bulk";
import { derive } from "./pages/derive";
import { authorizePage, authorizeWorkspace } from "./permissions";

/** The body a new page having the trait starts with: its template's (`TEMPLATE_TITLE`), when it has one. */
export async function templateBody(traitId: string) {
  const [template] = await db
    .select({ body: pages.body })
    .from(pages)
    .where(
      and(
        eq(pages.parentId, traitId),
        eq(pages.kind, "page"),
        eq(pages.title, TEMPLATE_TITLE),
        isNull(pages.deletedAt),
      ),
    )
    .limit(1);
  return template?.body ?? null;
}

/** A trait as the server reads it: a node of kind `trait`, its title its name and its schema its properties. */
export interface Trait {
  readonly id: string;
  readonly workspaceId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly icon: string | null;
  readonly properties: Schema;
}

interface TraitInput {
  readonly name?: string;
  readonly icon?: string | null;
  readonly properties?: Schema;
  /** Properties renamed, old name to new: renamed on every page that has the trait. */
  readonly renames?: Readonly<Record<string, string>>;
  /** Properties to take off the trait. */
  readonly drop?: readonly string[];
  /** Whether the pages having the trait lose the dropped properties (and their values) too, or keep them as theirs. */
  readonly dropFromPages?: boolean;
}

const traitColumns = {
  id: pages.id,
  workspaceId: pages.workspaceId,
  parentId: pages.parentId,
  name: pages.title,
  icon: pages.icon,
  properties: pages.schema,
};

const asTrait = (row: { workspaceId: string | null; id: string } & Omit<Trait, "workspaceId">): Trait => ({
  ...row,
  workspaceId: row.workspaceId ?? row.id,
});

/** A trait node read whole, as a trait. */
const nodeTrait = (
  page: Pick<typeof pages.$inferSelect, "id" | "workspaceId" | "parentId" | "title" | "icon" | "schema">,
) => asTrait({ ...page, name: page.title, properties: page.schema });

/**
 * Each workspace's traits as this instance last read them, kept until it writes anything (`writesCommitted`) or for a
 * little while, which is how long another instance's change can take to show here. Almost every read wants them.
 */
const known = new Map<string, { traits: Promise<Trait[]>; writes: number; at: number }>();
const TRAITS_MS = 30_000;

/** Drops what is known of a workspace's traits, for a write that changes them outside `transact`. */
export const forgetTraits = (workspaceId: string) => known.delete(workspaceId);

/** The workspace's traits (not the ones in the trash), by name. Inside a transaction they are read there, uncached. */
export function workspaceTraits(workspaceId: string, tx: Tx | typeof db = db): Promise<Trait[]> {
  if (tx !== db) return readTraits(workspaceId, tx);
  const held = known.get(workspaceId);
  if (held && held.writes === writesCommitted() && Date.now() - held.at < TRAITS_MS) return held.traits;
  const traits = readTraits(workspaceId, db);
  known.set(workspaceId, { traits, writes: writesCommitted(), at: Date.now() });
  traits.catch(() => known.delete(workspaceId));
  return traits;
}

async function readTraits(workspaceId: string, tx: Tx | typeof db): Promise<Trait[]> {
  const rows = await tx
    .select(traitColumns)
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), eq(pages.kind, "trait"), isNull(pages.deletedAt)))
    .orderBy(asc(pages.title));
  return rows.map(asTrait);
}

/** Every node's place in a workspace, for the paths that tell traits of one name apart. */
async function tree(workspaceId: string, tx: Tx | typeof db) {
  const rows = await tx
    .select({ id: pages.id, parentId: pages.parentId, title: pages.title })
    .from(pages)
    .where(and(or(eq(pages.workspaceId, workspaceId), eq(pages.id, workspaceId)), isNull(pages.deletedAt)));
  return new Map(rows.map((r) => [r.id, r]));
}

/** "Projects/Keep/Task": the titles from below the workspace down to the node. */
function pathOf(id: string, nodes: Map<string, { parentId: string | null; title: string }>) {
  const parts: string[] = [];
  let node = nodes.get(id);
  while (node?.parentId) {
    parts.unshift(node.title || "Untitled");
    node = nodes.get(node.parentId);
  }
  return parts.join("/");
}

/**
 * A trait of the workspace by id, by name (any case) or by path ("Projects/Task") when names repeat. A name two traits
 * share is refused, naming their paths.
 */
export async function findTrait(workspaceId: string, ref: string, tx: Tx | typeof db = db) {
  const all = await workspaceTraits(workspaceId, tx);
  const byId = all.find((t) => t.id === ref);
  if (byId) return byId;
  const want = ref.toLowerCase().replace(/^\/+|\/+$/g, "");
  const named = all.filter((t) => t.name.toLowerCase() === want);
  if (named.length === 1) return named[0] as Trait;
  const nodes = await tree(workspaceId, tx);
  const byPath = all.filter((t) => pathOf(t.id, nodes).toLowerCase() === want);
  if (byPath.length === 1) return byPath[0] as Trait;
  if (named.length > 1)
    throw new ApiError(`Traits named "${ref}": ${named.map((t) => pathOf(t.id, nodes)).join(", ")}. Name one by path`);
  throw new NotFoundError(`Trait "${ref}"`);
}

/** The traits a page has, as a reader sees them. */
export const traitsOfPage = (ids: readonly string[], all: readonly Trait[]) =>
  traitsOf(ids, all).map(({ id, name, icon }) => ({ id, name, icon }));

export async function listTraits(caller: Caller, workspaceId: string) {
  await authorizeWorkspace(caller, workspaceId, "read", { visitor: true });
  const [all, counts, nodes] = await Promise.all([
    workspaceTraits(workspaceId),
    db
      .select({ id: sql<string>`unnest(${pages.traits})`, pages: sql<number>`count(*)::int` })
      .from(pages)
      .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)))
      .groupBy(sql`1`),
    tree(workspaceId, db),
  ]);
  return all.map((trait) => ({
    ...trait,
    path: pathOf(trait.id, nodes),
    pages: counts.find((c) => c.id === trait.id)?.pages ?? 0,
  }));
}

export function checked(properties: Schema) {
  const parsed = schemaSchema.safeParse(properties);
  if (!parsed.success) throw new InvalidPropertyError("Properties", parsed.error.issues[0]?.message ?? "Invalid");
  return parsed.data;
}

/** A schema's property names, lowercased, as `prop_keys` has them. */
export const keysOf = (schema: Schema) => schema.map((p) => p.name.toLowerCase());
const keyArray = (keys: readonly string[]) =>
  sql`array[${sql.join(
    keys.map((k) => sql`${k}`),
    sql`, `,
  )}]::text[]`;

/** Nodes of a workspace having any property of these names (lowercased), through the `prop_keys` index. */
function havingAny(tx: Tx | typeof db, workspaceId: string, keys: readonly string[]) {
  return tx
    .select({ id: pages.id, kind: pages.kind, schema: pages.schema, properties: pages.properties })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), sql`prop_keys(${pages.schema}) && ${keyArray(keys)}`));
}

/**
 * Works out again which traits these pages have, and writes the ones that changed. `ids` are the pages that may have
 * gained or lost one; with `keys`, also every page having all those property names (a trait's, say).
 */
export async function rematch(tx: Tx, workspaceId: string, ids: readonly string[], keys?: readonly string[]) {
  const all = await workspaceTraits(workspaceId, tx);
  const conditions = [];
  if (ids.length) conditions.push(inArray(pages.id, [...ids]));
  if (keys?.length) conditions.push(sql`prop_keys(${pages.schema}) @> ${keyArray(keys)}`);
  if (!conditions.length) return;
  const candidates = await tx
    .select({ id: pages.id, schema: pages.schema, traits: pages.traits })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), eq(pages.kind, "page"), or(...conditions)));
  const changed = candidates.flatMap((page) => {
    const traits = inferTraits(page.schema, all);
    return traits.join() === page.traits.join() ? [] : [{ id: page.id, traits }];
  });
  await writeRows(tx, changed);
}

/** The same trait taken off every page that has it (it went to the trash). */
export async function forgetTrait(tx: Tx, id: string) {
  await tx.execute(
    sql`update page set traits = array_remove(traits, ${id}::uuid) where traits @> array[${id}]::uuid[]`,
  );
}

/**
 * Options changed on one select carried to every other select of its name in the workspace (`model/options.ts`): an
 * option removed takes its values with it there too.
 */
export async function shareOptions(tx: Tx, workspaceId: string, changes: readonly OptionChange[], except: string) {
  if (!changes.length) return;
  const rows = await havingAny(
    tx,
    workspaceId,
    changes.map((c) => c.name.toLowerCase()),
  );
  const removing = changes.some((c) => c.removed.length || c.changed.length);
  const written = rows.flatMap((row) => {
    if (row.id === except) return [];
    const schema = withOptionChanges(row.schema, changes);
    if (schema === row.schema) return [];
    return [{ ...row, schema, properties: removing ? keepValid(schema, row.properties) : row.properties }];
  });
  await writeRows(tx, written);
  // The search text names options: a renamed or removed one is read again.
  if (removing)
    for (const row of written) {
      const page = await tx.query.pages.findFirst({ where: eq(pages.id, row.id) });
      if (page) await derive(tx, page, page.schema);
    }
}

/** The options of the workspace's select of that name, from any node having one but `except`. */
export async function sharedOptions(tx: Tx, workspaceId: string, name: string, except?: string) {
  const rows = await havingAny(tx, workspaceId, [name.toLowerCase()]).limit(8);
  for (const row of rows) {
    if (row.id === except) continue;
    const definition = findProperty(row.schema, name);
    if (definition && isSelect(definition)) return definition.options ?? [];
  }
  return null;
}

export async function createTrait(
  caller: Caller,
  workspaceId: string,
  input: { name: string; icon?: string | null; properties?: Schema; parentId?: string | null },
) {
  await authorizeWorkspace(caller, workspaceId, "write");
  const { createPage } = await import("./pages/write");
  const page = await createPage(caller, input.parentId ?? workspaceId, {
    kind: "trait",
    title: input.name,
    icon: input.icon ?? null,
    schema: checked(input.properties ?? []),
  });
  return nodeTrait(page);
}

async function authorizeTrait(caller: Caller, id: string) {
  const page = await authorizePage(caller, id, "write");
  if (page.kind !== "trait") throw new NotFoundError("Trait");
  return nodeTrait(page);
}

/** A trait's name, icon or properties: the pages that have it follow, in the same transaction. */
export async function updateTrait(caller: Caller, id: string, input: TraitInput) {
  const trait = await authorizeTrait(caller, id);
  return transact(caller, async (tx, out) => {
    const { trait: updated, changed } = await changeTrait(tx, trait, input);
    for (const page of changed)
      out.page({ kind: "changed", before: null, after: page, changed: ["schema", "properties"], quiet: true });
    return updated;
  });
}

/**
 * The trait changed, and every page having it follows (`followTrait`): renamed properties renamed with their values,
 * the trait's definitions taking the place of theirs (a new type carries each value across), new ones added, dropped
 * ones gone when asked. Then which pages have which traits is worked out again, options it changed are shared, and
 * views of the workspace that named a renamed property name the new one.
 */
export async function changeTrait(tx: Tx, trait: Trait, input: TraitInput) {
  forgetTraits(trait.workspaceId);
  const renames = Object.fromEntries(
    Object.entries(input.renames ?? {}).filter(([from, to]) => from !== to && findProperty(trait.properties, from)),
  );
  const drop = new Set((input.drop ?? []).map((name) => name.toLowerCase()));
  const base = input.properties ?? renameSchema(trait.properties, renames);
  const after = checked(base.filter((p) => !drop.has(p.name.toLowerCase())).map((p) => renameInDefinition(p, renames)));
  const change: TraitChange = {
    before: trait.properties,
    after,
    renames,
    dropFromPages: input.dropFromPages ? drop : new Set(),
  };
  const having = await tx
    .select()
    .from(pages)
    .where(and(arrayContains(pages.traits, [trait.id]), eq(pages.kind, "page")));
  const rows = having.map((page) => {
    const followed = followTrait(page, change);
    const schema = followed.schema.map((p) => renameInDefinition(p, renames));
    return { ...page, schema, properties: followed.properties };
  });
  await writeRows(
    tx,
    rows.map(({ id, schema, properties }) => ({ id, schema, properties })),
  );
  // Values moved, changed type or went, or formulas read differently: formulas and search text are worked out again.
  const formulas = after.some((p) => p.type === "formula") || rows.some((r) => r.schema.some((p) => p.formula));
  if (Object.keys(renames).length || retyped(change).length || drop.size || formulas)
    for (const row of rows) await derive(tx, row, row.schema);
  const updated: Trait = {
    ...trait,
    name: input.name ?? trait.name,
    icon: input.icon === undefined ? trait.icon : input.icon,
    properties: after,
  };
  await tx
    .update(pages)
    .set({ title: updated.name, icon: updated.icon, schema: [...after], updatedAt: new Date() })
    .where(eq(pages.id, trait.id));
  const changes = after.flatMap((p) => {
    const was = findProperty(renameSchema(trait.properties, renames), p.name);
    return isSelect(p) && was && isSelect(was) ? (optionChange(p.name, was.options ?? [], p.options ?? []) ?? []) : [];
  });
  await shareOptions(tx, trait.workspaceId, changes, trait.id);
  await rematch(
    tx,
    trait.workspaceId,
    rows.map((r) => r.id),
    keysOf(after),
  );
  if (Object.keys(renames).length || drop.size) await renameInViews(tx, trait.workspaceId, renames, drop);
  return { trait: updated, changed: rows };
}

/** Filters, sorts, grouping and shown columns that named a renamed property follow it; a dropped one's go. */
async function renameInViews(tx: Tx, workspaceId: string, renames: Record<string, string>, drop: ReadonlySet<string>) {
  const lower = Object.fromEntries(Object.entries(renames).map(([from, to]) => [from.toLowerCase(), to]));
  const rename = (name: string) => lower[name.toLowerCase()] ?? name;
  const gone = (name: string) => drop.has(name.toLowerCase());
  const all = await tx
    .select({ view: views })
    .from(views)
    .innerJoin(pages, eq(pages.id, views.id))
    .where(eq(pages.workspaceId, workspaceId));
  for (const { view } of all) {
    await tx
      .update(views)
      .set({
        filter: view.filter.filter((f) => !gone(f.property)).map((f) => ({ ...f, property: rename(f.property) })),
        sort: view.sort.filter((s) => !gone(s.property)).map((s) => ({ ...s, property: rename(s.property) })),
        groupBy: view.groupBy && !gone(view.groupBy) ? rename(view.groupBy) : null,
        visibleProperties: view.visibleProperties?.filter((p) => !gone(p)).map(rename) ?? null,
        barProperties: view.barProperties?.filter((p) => !gone(p)).map(rename) ?? null,
      })
      .where(eq(views.id, view.id));
  }
}

/** Takes a trait away (to the trash): pages keep its properties, they just no longer have it. */
export async function deleteTrait(caller: Caller, id: string) {
  await authorizeTrait(caller, id);
  const { deletePage } = await import("./pages/write");
  await deletePage(caller, id);
  return { id };
}

const PICK_LIMIT = 30;

/** Pages that have a trait whose title contains `query`: what a relation constrained to the trait offers. */
export async function traitPages(caller: Caller, id: string, query: string) {
  const trait = await db.query.pages.findFirst({ where: and(eq(pages.id, id), eq(pages.kind, "trait")) });
  if (!trait?.workspaceId) throw new NotFoundError("Trait");
  await authorizeWorkspace(caller, trait.workspaceId, "read", { visitor: true });
  const scope = await visitorScope(caller.person.id, trait.workspaceId);
  return await db
    .select({ id: pages.id, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, trait.workspaceId),
        isNull(pages.deletedAt),
        ne(pages.kind, "trait"),
        arrayContains(pages.traits, [trait.id]),
        scope ? inScope(scope) : undefined,
        sql`${pages.title} ilike ${`%${query.replace(/[%_\\]/g, "\\$&")}%`}`,
      ),
    )
    .orderBy(asc(pages.title))
    .limit(PICK_LIMIT);
}
