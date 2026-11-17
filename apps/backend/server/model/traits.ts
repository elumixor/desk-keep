import { z } from "zod";
import { coerceValues } from "./coerce";
import {
  findProperty,
  keepValid,
  type PropertyDefinition,
  type PropertyValues,
  renameSchema,
  renameValues,
  type Schema,
  sameType,
  schemaSchema,
} from "./properties";

/**
 * Traits: named sets of property definitions, like TypeScript interfaces. A page has a trait when it has every one of
 * the trait's properties (same name in any case, same type): nobody gives a page a trait, the server works out which
 * it has on every change and keeps them in the page's `traits`. A trait is a node of the tree (a page of kind
 * `trait`), its properties are its `schema`. Pure: the server loads pages and traits, this decides what they mean.
 */

export const traitInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  icon: z.string().max(64).nullable().optional(),
  properties: schemaSchema,
});

export interface TraitShape {
  readonly id: string;
  readonly name: string;
  readonly properties: Schema;
}

/** The traits of those ids, in their order; an id no trait has any more is skipped. */
export const traitsOf = <T extends { readonly id: string }>(ids: readonly string[], all: readonly T[]): T[] =>
  ids.flatMap((id) => all.find((t) => t.id === id) ?? []);

/** Whether a page with these properties has a trait: all of its properties, none missing. A trait of none has no pages. */
export const satisfies = (schema: Schema, trait: Schema) =>
  trait.length > 0 &&
  trait.every((wanted) => {
    const have = findProperty(schema, wanted.name);
    return !!have && sameType(have, wanted);
  });

/** The ids of the traits a page with these properties has, in the traits' order. */
export const inferTraits = (schema: Schema, all: readonly { id: string; properties: Schema }[]) =>
  all.filter((t) => satisfies(schema, t.properties)).map((t) => t.id);

export interface TraitChange {
  readonly before: Schema;
  readonly after: Schema;
  /** Properties renamed, old name to new, as the trait's editor said. */
  readonly renames: Readonly<Record<string, string>>;
  /** Properties taken off the trait that its pages lose too (lowercased); others taken off stay on the pages. */
  readonly dropFromPages?: ReadonlySet<string>;
}

/** Which properties of the trait changed type, by their new name (after renames). */
export function retyped({ before, after, renames }: TraitChange): PropertyDefinition[] {
  const renamed = renameSchema(before, renames);
  return after.filter((p) => {
    const old = findProperty(renamed, p.name);
    return old && !sameType(old, p);
  });
}

/**
 * A page that had a trait, after the trait changed: renamed properties renamed (values with them), the trait's
 * definitions taking the place of the page's (a new type carries each value across), new ones added, and the ones the
 * trait dropped from its pages gone with their values. Properties of its own stay as they were.
 */
export function followTrait(page: { schema: Schema; properties: PropertyValues }, change: TraitChange) {
  const renames = Object.fromEntries(
    Object.entries(change.renames).flatMap(([from, to]) => {
      const own = findProperty(page.schema, from);
      return own ? [[own.name, to]] : [];
    }),
  );
  const before = renameSchema(page.schema, renames);
  const values = renameValues(page.properties, renames);
  const drop = change.dropFromPages ?? new Set<string>();
  const kept = before
    .filter((p) => !drop.has(p.name.toLowerCase()) || findProperty(change.after, p.name))
    .map((p) => findProperty(change.after, p.name) ?? p);
  const schema = [...kept, ...change.after.filter((p) => !findProperty(kept, p.name))];
  const carried = coerceValues(before, schema, values);
  return { schema: carried.schema, properties: keepValid(carried.schema, carried.values) };
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `prop("Old")` in a script or formula as `prop("New")`, for a renamed property. */
function renameProps(source: string, renames: Readonly<Record<string, string>>) {
  let out = source;
  for (const [from, to] of Object.entries(renames))
    out = out.replace(
      new RegExp(`\\bprop\\(\\s*(["'])${escaped(from)}\\1\\s*\\)`, "gi"),
      `prop(${JSON.stringify(to)})`,
    );
  return out;
}

/** A definition naming renamed properties by their new names, in a formula or a button's code. */
export function renameInDefinition(definition: PropertyDefinition, renames: Readonly<Record<string, string>>) {
  if (!Object.keys(renames).length) return definition;
  return {
    ...definition,
    ...(definition.formula && { formula: renameProps(definition.formula, renames) }),
    ...(definition.code && { code: renameProps(definition.code, renames) }),
  };
}

/**
 * The `trait` action (`model/sync.ts`): a trait's properties changed, and every page having it following, as one
 * synced write the screens draw at once and can undo. `properties` is the trait's schema after the change; `restore`,
 * sent by an undo, puts pages' properties and values back exactly as they were before it.
 */
export const traitPayloadSchema = z.object({
  /** The trait, then the pages having it: what the change is drawn on. */
  nodes: z.array(z.uuid()).min(1),
  properties: schemaSchema,
  renames: z.record(z.string(), z.string().trim().min(1).max(200)).optional(),
  drop: z.array(z.string()).optional(),
  dropFromPages: z.boolean().optional(),
  restore: z
    .record(z.uuid(), z.object({ schema: schemaSchema, properties: z.record(z.string(), z.unknown()) }))
    .optional(),
});
export type TraitPayload = z.infer<typeof traitPayloadSchema>;

/** A trait's schema after renaming, dropping and the definitions naming renamed properties: what its pages follow. */
export function traitAfter(
  current: Schema,
  {
    properties,
    renames = {},
    drop = [],
  }: { properties?: Schema; renames?: Record<string, string>; drop?: readonly string[] },
): Schema {
  const gone = new Set(drop.map((name) => name.toLowerCase()));
  return (properties ?? renameSchema(current, renames))
    .filter((p) => !gone.has(p.name.toLowerCase()))
    .map((p) => renameInDefinition(p, renames));
}

/** A page having the trait, as the change leaves it (what the server writes, drawn on the device first). */
export function followed(page: { id: string; schema: Schema; properties: PropertyValues }, payload: TraitPayload) {
  const back = payload.restore?.[page.id];
  if (back) return { schema: back.schema, properties: back.properties as PropertyValues };
  const renames = payload.renames ?? {};
  const out = followTrait(page, {
    before: [],
    after: payload.properties,
    renames,
    dropFromPages: new Set(payload.dropFromPages ? (payload.drop ?? []).map((n) => n.toLowerCase()) : []),
  });
  return { schema: out.schema.map((p) => renameInDefinition(p, renames)), properties: out.properties };
}

/** The change that takes a `trait` action back: the trait's schema, names and its pages as they are now. */
export function traitInverse(
  trait: { schema: Schema },
  payload: TraitPayload,
  find: (id: string) => { schema: Schema; properties: PropertyValues } | undefined,
): TraitPayload {
  const [, ...pageIds] = payload.nodes;
  return {
    nodes: payload.nodes,
    properties: [...trait.schema],
    renames: Object.fromEntries(Object.entries(payload.renames ?? {}).map(([from, to]) => [to, from])),
    restore: Object.fromEntries(
      pageIds.flatMap((id) => {
        const page = find(id);
        return page ? [[id, { schema: [...page.schema], properties: { ...page.properties } }]] : [];
      }),
    ),
  };
}
