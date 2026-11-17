import { and, eq, inArray, isNull, max, notInArray, sql } from "drizzle-orm";
import type { Tx } from "~/db";
import { pages, views } from "~/db/schema";
import { coerceValues } from "~/model/coerce";
import type { DocNode } from "~/model/document";
import { addedMentions, pageMentions } from "~/model/mentions";
import type { NodeKind } from "~/model/nodes";
import { adoptOptions, isSelect, type OptionChange, optionChange, remapValue, remapValues } from "~/model/options";
import {
  allowedTraits,
  findProperty,
  InvalidPropertyError,
  keepValid,
  mergeSchema,
  type PropertyValues,
  renameSchema,
  renameValues,
  type Schema,
  sameType,
  validateValues,
} from "~/model/properties";
import type { MovePayload } from "~/model/sync";
import { inferTraits } from "~/model/traits";
import { sortBefore } from "~/model/tree";
import type { Cleanup, Filter, Sort, ViewKind } from "~/model/views";
import { inScope, scopeOf } from "../access";
import { accountId, authorId, type Caller } from "../auth/caller";
import { ApiError, ConflictError, NotFoundError } from "../http/api-error";
import { type Outbox, transact } from "../notify/outbox";
import { authorizePage, authorizePages, type PageWithBody } from "../permissions";
import { afterMove, beforeMove } from "../shares";
import {
  changeTrait,
  checked,
  findTrait,
  forgetTrait,
  keysOf,
  rematch,
  sharedOptions,
  shareOptions,
  workspaceTraits,
} from "../traits";
import { derive, refreshDependents } from "./derive";
import { recordVersion } from "./record-version";
import { subtree } from "./subtree";

/** What a view node shows (`db/schema` `views`). */
export interface ViewConfig {
  readonly kind?: ViewKind;
  readonly traits?: readonly string[];
  readonly filter?: readonly Filter[];
  readonly sort?: readonly Sort[];
  readonly groupBy?: string | null;
  readonly visibleProperties?: readonly string[] | null;
  readonly barProperties?: readonly string[] | null;
  readonly sortCode?: string | null;
  readonly newParent?: string | null;
  readonly showArchived?: boolean;
  readonly cleanup?: Cleanup | null;
}

export interface PageInput {
  /** The id a client chose for a page it creates (`lib/sync`), so it can show and write to it before the answer. */
  readonly id?: string;
  /** What a new node is: a page (the default), a trait or a view. */
  readonly kind?: NodeKind;
  /** Where a new page goes among its siblings; after the last one when absent. */
  readonly sort?: number;
  readonly title?: string;
  readonly icon?: string | null;
  readonly description?: string;
  readonly body?: DocNode;
  /** Values by property name; `null` clears one. */
  readonly properties?: Readonly<Record<string, unknown>>;
  /** The page's properties, replacing the ones it had (values of removed ones go with them). */
  readonly schema?: Schema;
  /** Properties to add, or replace by name, keeping the rest: what a writer that only knows its own uses. */
  readonly addProperties?: Schema;
  /** Properties renamed, old name to new; their values move with them. */
  readonly renames?: Readonly<Record<string, string>>;
  /** Traits (by id, name or path) whose properties the page is given, so it has them. */
  readonly traits?: readonly string[];
  /** A new view's query. */
  readonly view?: ViewConfig;
  /** The `updatedAt` the client last saw; a page changed since then is not overwritten (`ConflictError`). */
  readonly baseUpdatedAt?: string;
}

interface PageProperties {
  readonly schema: Schema;
  readonly properties: PropertyValues;
}

/**
 * Each select of the page joins the workspace's list of its name (`model/options.ts`): a new one takes the list (its
 * own options of new names added, values following by name), and options changed on one it had are changes to share.
 */
async function joinOptions(
  tx: Tx,
  workspaceId: string,
  id: string | undefined,
  before: Schema,
  page: PageProperties,
): Promise<
  PageProperties & { changes: OptionChange[]; remap: (values: Record<string, unknown>) => Record<string, unknown> }
> {
  let properties = page.properties;
  const changes: OptionChange[] = [];
  const adopted = new Map<string, ReadonlyMap<string, string>>();
  const schema: Schema = await Promise.all(
    page.schema.map(async (definition) => {
      if (!isSelect(definition)) return definition;
      const had = findProperty(before, definition.name);
      let base = had && isSelect(had) ? (had.options ?? []) : null;
      let options = definition.options ?? [];
      if (!base) {
        base = (await sharedOptions(tx, workspaceId, definition.name, id)) ?? [];
        const joined = adoptOptions(options, base);
        options = joined.options;
        properties = remapValues(properties, definition.name, joined.ids);
        adopted.set(definition.name.toLowerCase(), joined.ids);
      }
      const change = optionChange(definition.name, base, options);
      if (change) changes.push(change);
      return options === definition.options ? definition : { ...definition, options };
    }),
  );
  // Values written with the options' old ids name the ones standing for them now.
  const remap = (values: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const ids = adopted.get(key.toLowerCase());
        return [key, ids ? remapValue(value as never, ids) : value];
      }),
    );
  return { schema, properties, changes, remap };
}

/**
 * The properties and values a write leaves a page with: renames, a new schema, traits' properties given, then added
 * properties and values; its selects share their options with the workspace's of their name. A page's traits are
 * worked out from what it ends up with. A trait or a view holds no values.
 */
async function nextProperties(
  tx: Tx,
  caller: Caller,
  workspaceId: string,
  current: PageProperties & { id?: string; kind: NodeKind },
  input: PageInput,
) {
  const renames = Object.fromEntries(
    Object.entries(input.renames ?? {}).flatMap(([from, to]) => {
      const own = findProperty(current.schema, from);
      return own && own.name !== to ? [[own.name, to]] : [];
    }),
  );
  const before = renameSchema(current.schema, renames);
  // A property whose type changed carries its value across, read as the new type.
  const carried = coerceValues(before, checked(input.schema ?? before), renameValues(current.properties, renames));
  let schema: Schema = checked(carried.schema);
  let properties: PropertyValues = carried.values;
  for (const ref of input.traits ?? []) {
    const trait = await findTrait(workspaceId, ref, tx);
    for (const property of trait.properties) {
      const own = findProperty(schema, property.name);
      if (own && !sameType(own, property))
        throw new InvalidPropertyError(own.name, `is a ${own.type} here and a ${property.type} in ${trait.name}`);
    }
    const missing = trait.properties.filter((p) => !findProperty(schema, p.name));
    schema = checked(mergeSchema(schema, missing));
  }
  if (input.addProperties?.length) schema = checked(mergeSchema(schema, input.addProperties));
  const joined = await joinOptions(tx, workspaceId, current.id, current.schema, { schema, properties });
  schema = joined.schema;
  if (current.kind !== "page") return { schema, traits: [], properties: {}, changes: joined.changes };
  // A removed property, or a value the new type cannot hold, goes.
  properties = keepValid(schema, joined.properties);
  const written = validateValues(schema, joined.remap(input.properties ?? {}));
  const merged: Record<string, unknown> = { ...properties };
  for (const [key, value] of Object.entries(written)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  await checkRelationTargets(tx, caller, workspaceId, schema, written, current.properties);
  const traits = inferTraits(schema, await workspaceTraits(workspaceId, tx));
  return { schema, traits, properties: merged as PropertyValues, changes: joined.changes };
}

/**
 * A relation points only at pages the writer may read (the ones it had are kept), and one constrained to traits only at
 * pages that have one of them.
 */
async function checkRelationTargets(
  tx: Tx,
  caller: Caller,
  workspaceId: string,
  schema: Schema,
  written: Record<string, unknown>,
  had: PropertyValues,
) {
  const added = schema.flatMap((property) => {
    const ids = written[property.name];
    if (property.type !== "relation" || !Array.isArray(ids)) return [];
    const before = had[property.name];
    return (ids as string[]).filter((id) => !(Array.isArray(before) && before.includes(id)));
  });
  if (added.length) {
    const scope = await scopeOf(accountId(caller));
    const readable = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(and(inArray(pages.id, added), inScope(scope)));
    if (readable.length < new Set(added).size) throw new ApiError("A relation can only point at pages you can open");
  }
  for (const property of schema) {
    const ids = written[property.name];
    const allowed = allowedTraits(property);
    if (property.type !== "relation" || !allowed.length || !Array.isArray(ids) || !ids.length) continue;
    const found = await Promise.all(allowed.map((id) => findTrait(workspaceId, id, tx)));
    const targets = await tx.query.pages.findMany({
      where: inArray(pages.id, ids as string[]),
      columns: { id: true, traits: true },
    });
    const outside = (ids as string[]).filter(
      (id) => !targets.find((t) => t.id === id)?.traits.some((t) => allowed.includes(t)),
    );
    if (outside.length)
      throw new InvalidPropertyError(
        property.name,
        `Only pages that are ${found.map((t) => t.name).join(" or ")} can be picked`,
      );
  }
}

async function nextSort(tx: Tx, parentId: string) {
  const [row] = await tx
    .select({ value: max(pages.sort) })
    .from(pages)
    .where(eq(pages.parentId, parentId));
  return (row?.value ?? 0) + 1;
}

/** A view and the trait it shows alone may share a title: the ids of the page's partners. */
async function partnerIds(tx: Tx, id: string): Promise<string[]> {
  const [view] = await tx.select({ traits: views.traits }).from(views).where(eq(views.id, id));
  if (view) return view.traits.length === 1 ? view.traits : [];
  const shown = await tx.select({ id: views.id }).from(views).where(sql`${views.traits} = ARRAY[${id}]::uuid[]`);
  return shown.map((v) => v.id);
}

const titleTaken = async (tx: Tx, parentId: string, title: string, except?: string) => {
  if (!title.trim()) return false;
  const excluded = except ? [except, ...(await partnerIds(tx, except))] : [];
  return !!(await tx.query.pages.findFirst({
    where: and(
      eq(pages.parentId, parentId),
      isNull(pages.deletedAt),
      sql`lower(${pages.title}) = lower(${title})`,
      excluded.length ? notInArray(pages.id, excluded) : undefined,
    ),
    columns: { id: true },
  }));
};

/** A title no other node under the parent has: the one wanted, else numbered ("Task (2)"). */
export async function freeTitle(tx: Tx, parentId: string, title: string, except?: string) {
  if (!(await titleTaken(tx, parentId, title, except))) return title;
  for (let n = 2; ; n++) {
    const numbered = `${title} (${n})`;
    if (!(await titleTaken(tx, parentId, numbered, except))) return numbered;
  }
}

class TitleTakenError extends ApiError {
  constructor(title: string) {
    super(`There is already something named "${title}" here`, 409);
    this.name = "TitleTakenError";
  }
}

export async function createPage(caller: Caller, parentId: string, input: PageInput) {
  const parent = await authorizePage(caller, parentId, "write");
  if (parent.deletedAt) throw new ApiError("That page is in the trash");
  const workspaceId = parent.workspaceId ?? parent.id;
  const kind = input.kind ?? "page";
  return transact(caller, async (tx, out) => {
    const { schema, traits, properties, changes } = await nextProperties(
      tx,
      caller,
      workspaceId,
      { schema: [], properties: {}, kind },
      input,
    );
    const [page] = await tx
      .insert(pages)
      .values({
        ...(input.id && { id: input.id }),
        parentId,
        workspaceId,
        kind,
        title: await freeTitle(tx, parentId, input.title ?? ""),
        icon: input.icon ?? null,
        description: input.description ?? "",
        body: input.body ?? null,
        properties,
        schema: [...schema],
        traits: [...traits],
        sort: input.sort ?? (await nextSort(tx, parentId)),
        createdBy: authorId(caller),
      })
      .returning();
    if (kind === "view") await tx.insert(views).values({ id: page.id, ...viewValues(input.view ?? {}) });
    await shareOptions(tx, workspaceId, changes, page.id);
    // A new trait's pages are the ones already having its properties.
    if (kind === "trait" && schema.length) await rematch(tx, workspaceId, [], keysOf(schema));
    const derived = await derive(tx, page, schema);
    await refreshDependents(tx, page.id);
    const created = { ...page, ...derived };
    await recordVersion(tx, caller, null, created);
    notifyMentions(out, null, created);
    out.page({ kind: "created", before: null, after: created, changed: [] });
    return created;
  });
}

/** Whoever the write newly names (in the title, the body, a person property) is told; `before` null = created. */
function notifyMentions(out: Outbox, before: PageWithBody | null, after: PageWithBody) {
  for (const [to, site] of addedMentions(before && pageMentions(before), pageMentions(after)))
    out.notify({
      type: "mention",
      to,
      pageId: after.id,
      mention: site.where,
      property: site.property,
      text: site.snippet,
    });
}

const viewValues = (config: ViewConfig) => ({
  kind: config.kind ?? "table",
  traits: [...(config.traits ?? [])],
  filter: [...(config.filter ?? [])],
  sort: [...(config.sort ?? [])],
  groupBy: config.groupBy ?? null,
  visibleProperties: config.visibleProperties ? [...config.visibleProperties] : null,
  barProperties: config.barProperties ? [...config.barProperties] : null,
  sortCode: config.sortCode ?? null,
  newParent: config.newParent ?? null,
  showArchived: config.showArchived ?? false,
  cleanup: config.cleanup ?? null,
});

/** `restoredFrom` is when the version a restore brings back was made (`./versions`). */
export async function updatePage(caller: Caller, id: string, input: PageInput, restoredFrom?: Date) {
  const page = await authorizePage(caller, id, "write", { body: true });
  if (input.baseUpdatedAt && page.updatedAt.getTime() > new Date(input.baseUpdatedAt).getTime())
    throw new ConflictError();
  return transact(caller, async (tx, out) => {
    // Read again inside the transaction: a trait or a shared option may have changed this page meanwhile.
    const current = (await tx.query.pages.findFirst({ where: eq(pages.id, id) })) ?? page;
    const workspaceId = current.workspaceId ?? current.id;
    if (input.title !== undefined && current.parentId && (await titleTaken(tx, current.parentId, input.title, id)))
      throw new TitleTakenError(input.title);
    const touchesSchema = input.schema || input.renames || input.addProperties || input.traits;
    // A trait's properties change through the trait, so every page having it follows.
    if (current.kind === "trait" && touchesSchema)
      await changeTrait(
        tx,
        { ...current, workspaceId, name: current.title, properties: current.schema },
        {
          properties: input.addProperties
            ? [...mergeSchema(input.schema ?? current.schema, input.addProperties)]
            : input.schema,
          renames: input.renames,
        },
      );
    const next =
      current.kind === "trait"
        ? {
            schema: (await tx.query.pages.findFirst({ where: eq(pages.id, id) }))?.schema ?? current.schema,
            traits: [],
            properties: {},
            changes: [],
          }
        : await nextProperties(tx, caller, workspaceId, current, input);
    const [updated] = await tx
      .update(pages)
      .set({
        title: input.title ?? current.title,
        icon: input.icon === undefined ? current.icon : input.icon,
        description: input.description ?? current.description,
        body: input.body ?? current.body,
        properties: next.properties,
        schema: [...next.schema],
        traits: [...next.traits],
        updatedAt: new Date(),
      })
      .where(eq(pages.id, id))
      .returning();
    if (current.kind === "view" && input.view && Object.keys(viewPatch(input.view)).length)
      await tx.update(views).set(viewPatch(input.view)).where(eq(views.id, id));
    await shareOptions(tx, workspaceId, next.changes, id);
    const derived = await derive(tx, updated, next.schema);
    await refreshDependents(tx, id);
    const after = { ...updated, ...derived };
    await recordVersion(tx, caller, current, after, restoredFrom);
    notifyMentions(out, current, after);
    out.page({
      kind: "changed",
      before: current,
      after,
      changed: Object.entries(input)
        .filter(([key, value]) => key !== "baseUpdatedAt" && value !== undefined)
        .map(([key]) => key),
    });
    return after;
  });
}

/** Only what a patch names. */
function viewPatch(config: ViewConfig) {
  const { traits, filter, sort, visibleProperties, barProperties, ...rest } = config;
  return {
    ...rest,
    ...(traits && { traits: [...traits] }),
    ...(filter && { filter: [...filter] }),
    ...(sort && { sort: [...sort] }),
    ...(visibleProperties !== undefined && { visibleProperties: visibleProperties ? [...visibleProperties] : null }),
    ...(barProperties !== undefined && { barProperties: barProperties ? [...barProperties] : null }),
  };
}

/** Moves a page under `parentId`: before `beforeId` among its children (last when null), or at a `sort` a client chose. */
export async function movePage(
  caller: Caller,
  id: string,
  parentId: string,
  at: { readonly beforeId: string | null } | { readonly sort: number },
) {
  const page = await authorizePage(caller, id, "write", { body: true });
  const parent = await authorizePage(caller, parentId, "write");
  if (!page.parentId) throw new ApiError("A workspace cannot be moved");
  if (parent.workspaceId !== page.workspaceId) throw new ApiError("Pages move within their workspace");
  return transact(caller, async (tx, out) => {
    const descendants = await tx.execute<{ id: string }>(subtree(id));
    if (descendants.some((row) => row.id === parentId)) throw new ApiError("A page cannot move into itself");
    let sort: number;
    if ("sort" in at) sort = at.sort;
    else {
      const siblings = await tx.query.pages.findMany({
        where: and(eq(pages.parentId, parentId), isNull(pages.deletedAt)),
        columns: { id: true, sort: true },
        orderBy: pages.sort,
      });
      sort = sortBefore(
        siblings.filter((s) => s.id !== id),
        at.beforeId,
      );
    }
    const title = parentId === page.parentId ? page.title : await freeTitle(tx, parentId, page.title, id);
    const sharers = parentId === page.parentId ? null : await beforeMove(tx, id);
    const [moved] = await tx
      .update(pages)
      .set({ parentId, sort, title, updatedAt: new Date() })
      .where(eq(pages.id, id))
      .returning();
    if (sharers) await afterMove(tx, moved, sharers);
    // Where a page sits changes what its formulas read.
    await derive(tx, moved, moved.schema);
    out.page({ kind: "moved", before: page, after: moved, changed: ["parentId", "sort"], fromParentId: page.parentId });
    return moved;
  });
}

/**
 * Moves many pages at once, each to its parent and place (`moves`), in one transaction: what a bulk move in the tree
 * sends as one write. Pages stay in their workspace and never go inside themselves.
 */
export async function movePages(caller: Caller, moves: MovePayload["moves"]) {
  const ids = Object.keys(moves);
  if (!ids.length) return;
  const parentIds = [...new Set(Object.values(moves).map((m) => m.parentId))];
  const byId = await authorizePages(caller, [...ids, ...parentIds], "write");
  const workspaceId = byId.get(ids[0])?.workspaceId;
  for (const id of [...ids, ...parentIds]) {
    const row = byId.get(id);
    if (!row || !workspaceId) throw new NotFoundError("Page");
    if (row.workspaceId !== workspaceId) throw new ApiError("Pages move within their workspace");
  }
  if (ids.some((id) => !byId.get(id)?.parentId)) throw new ApiError("A workspace cannot be moved");
  await transact(caller, async (tx, out) => {
    for (const parentId of parentIds) {
      const above = await tx.execute<{ id: string }>(sql`
        with recursive up as (
          select id, parent_id from page where id = ${parentId}
          union all select p.id, p.parent_id from page p join up on p.id = up.parent_id
        ) select id from up`);
      if (above.some((row) => moves[row.id])) throw new ApiError("A page cannot move into itself");
    }
    for (const id of ids) {
      const page = byId.get(id) as PageWithBody;
      const { parentId, sort } = moves[id];
      const title = parentId === page.parentId ? page.title : await freeTitle(tx, parentId, page.title, id);
      const sharers = parentId === page.parentId ? null : await beforeMove(tx, id);
      const [row] = await tx
        .update(pages)
        .set({ parentId, sort, title, updatedAt: new Date() })
        .where(eq(pages.id, id))
        .returning();
      if (sharers) await afterMove(tx, row, sharers);
      // Where a page sits changes what its formulas read.
      await derive(tx, row, row.schema);
      out.page({ kind: "moved", before: page, after: row, changed: ["parentId", "sort"], fromParentId: page.parentId });
    }
  });
}

/** Moves a page and everything under it to the trash, stamped with one time so a restore brings back exactly that. */
export async function deletePage(caller: Caller, id: string) {
  const page = await authorizePage(caller, id, "delete", { body: true });
  if (!page.parentId) throw new ApiError("Delete a workspace from its settings");
  const at = new Date();
  await transact(caller, async (tx, out) => {
    const trashed = await tx.execute<{ id: string; kind: string }>(
      sql`update page set deleted_at = ${at.toISOString()}::timestamptz where deleted_at is null and id in (${subtree(id)}) returning id, kind`,
    );
    // A trait in the trash is nobody's.
    for (const row of trashed) if (row.kind === "trait") await forgetTrait(tx, row.id);
    await tellTrashed(tx, out, "trashed", id, trashed);
  });
  return { id, deletedAt: at };
}

export async function restorePage(caller: Caller, id: string) {
  const page = await authorizePage(caller, id, "delete", { body: true });
  if (!page.deletedAt) return page;
  const deletedAt = page.deletedAt;
  await transact(caller, async (tx, out) => {
    // Back under its parent with a name nothing there has taken meanwhile.
    if (page.parentId) {
      const title = await freeTitle(tx, page.parentId, page.title, id);
      if (title !== page.title) await tx.update(pages).set({ title }).where(eq(pages.id, id));
    }
    const restored = await tx.execute<{ id: string; kind: string; schema: Schema }>(
      sql`update page set deleted_at = null where deleted_at = ${deletedAt.toISOString()}::timestamptz and id in (${subtree(id)}) returning id, kind, schema`,
    );
    const workspaceId = page.workspaceId ?? page.id;
    // Traits back from the trash find their pages again, and pages back find their traits.
    const pagesBack = restored.filter((r) => r.kind === "page").map((r) => r.id);
    await rematch(tx, workspaceId, pagesBack);
    for (const row of restored)
      if (row.kind === "trait" && row.schema.length) await rematch(tx, workspaceId, [], keysOf(row.schema));
    await tellTrashed(tx, out, "restored", id, restored);
  });
  return { ...page, deletedAt: null };
}

/**
 * Tells of a subtree trashed or restored: every page in it to its watchers, the page it started from also to its
 * parent's watchers and the webhooks (one event, as before).
 */
async function tellTrashed(
  tx: Tx,
  out: Outbox,
  kind: "trashed" | "restored",
  rootId: string,
  rows: readonly { readonly id: string }[],
) {
  if (!rows.length) return;
  const all = await tx.query.pages.findMany({
    where: inArray(
      pages.id,
      rows.map((r) => r.id),
    ),
  });
  for (const row of all) out.page({ kind, before: row, after: row, changed: ["deletedAt"], nested: row.id !== rootId });
}
