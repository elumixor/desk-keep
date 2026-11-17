import { findProperty, type PropertyDefinition, type PropertyType, type Schema, sameName } from "$model/properties";
import { confirm } from "./stores/confirm.svelte";
import { newProperty } from "./stores/new-property.svelte";
import { pages } from "./stores/pages.svelte";
import { traitChanges } from "./stores/trait-changes.svelte";
import { traits } from "./stores/traits.svelte";
import { pageRecords, synced } from "./sync/client.svelte";
import { local } from "./sync/local.svelte";
import { TAG_COLORS } from "./tags";

/**
 * Whose properties a change is to: one page's (`{ page: id }`), or a trait's (`{ trait: id }`), which every page
 * having it follows.
 */
export type SchemaTarget = { readonly page: string } | { readonly trait: string };

interface Change {
  readonly renames?: Record<string, string>;
  readonly drop?: string[];
  readonly dropFromPages?: boolean;
}

/** A page's changes are drawn at once and synced behind; a trait's are saved, and the pages following it synced after. */
function write(target: SchemaTarget, schema: Schema, change: Change = {}) {
  if ("page" in target) {
    pages.edit(target.page, { schema: [...schema], ...(change.renames && { renames: change.renames }) });
    return;
  }
  void traits.update(target.trait, { properties: [...schema], ...change });
}

class SchemaUnknownError extends Error {
  constructor(target: SchemaTarget) {
    super(`The properties of ${"page" in target ? target.page : target.trait} are not loaded yet`);
    this.name = "SchemaUnknownError";
  }
}

/** The properties a change rewrites: the page's, or the trait's. */
export function schemaOf(target: SchemaTarget): Schema {
  const schema = "page" in target ? local.page(target.page)?.schema : traits.get(target.trait)?.properties;
  if (!schema) throw new SchemaUnknownError(target);
  return schema;
}

/** The traits of a page that have a property: what renaming, retyping or deleting it on the page alone leaves. */
function traitsHaving(target: SchemaTarget, name: string) {
  if (!("page" in target)) return [];
  const page = local.page(target.page);
  if (!page) return [];
  return local
    .traitIds(page)
    .flatMap((id) => traits.get(id) ?? [])
    .filter((t) => findProperty(t.properties, name));
}

export function addOption(target: SchemaTarget, property: string, name: string): string {
  const schema = schemaOf(target);
  const id = crypto.randomUUID();
  const color = TAG_COLORS[(schema.find((p) => p.name === property)?.options?.length ?? 0) % TAG_COLORS.length];
  write(
    target,
    schema.map((p) => (p.name === property ? { ...p, options: [...(p.options ?? []), { id, name, color }] } : p)),
  );
  return id;
}

/** A name for a new property of a type that no property in `taken` has yet. */
function freshName(taken: Schema, type: PropertyType, wanted?: string) {
  const base =
    wanted ?? (type === "formula" ? "Formula" : type.replace("_", " ").replace(/^./, (c) => c.toUpperCase()));
  let name = base;
  for (let n = 2; findProperty(taken, name); n++) name = `${base} ${n}`;
  return name;
}

const isSelectType = (type: PropertyType) => type === "select" || type === "multi_select";

/** What a fresh property of a type starts with. */
const typeDefaults = (type: PropertyType): Partial<PropertyDefinition> => ({
  ...(isSelectType(type) && { options: [] }),
  ...(type === "formula" && { formula: "" }),
  ...(type === "button" && { code: "" }),
});

/** The settings only one type has, which a property of another type drops. */
const TYPE_SETTINGS = [
  "options",
  "formula",
  "extension",
  "extType",
  "multiple",
  "fields",
  "trait",
  "label",
  "code",
] as const;

/** A property definition of a type; `extra` carries what an extension's type says (its name, which extension…). */
export function newDefinition(
  taken: Schema,
  type: PropertyType,
  extra: Partial<PropertyDefinition> = {},
): PropertyDefinition {
  return { ...typeDefaults(type), ...extra, name: freshName(taken, type, extra.name), type };
}

/** Adds a property, its name field taking the focus to name it. */
export function addProperty(target: SchemaTarget, type: PropertyType, extra: Partial<PropertyDefinition> = {}) {
  const schema = schemaOf(target);
  const definition = newDefinition(schema, type, extra);
  write(target, [...schema, definition]);
  newProperty.mark(definition.name);
  return definition;
}

/**
 * Gives a property another type (with what `extra` says of it, its name aside): the old type's settings go, but a
 * select's options stay when it stays a select.
 */
export function retype(
  target: SchemaTarget,
  definition: PropertyDefinition,
  type: PropertyType,
  { name: _name, ...extra }: Partial<PropertyDefinition> = {},
) {
  const cleared = Object.fromEntries(TYPE_SETTINGS.map((key) => [key, undefined]));
  const options = isSelectType(definition.type) && isSelectType(type) ? { options: definition.options } : {};
  updateProperty(target, definition.name, { ...cleared, ...typeDefaults(type), ...options, ...extra, type });
}

/**
 * Changes a property; a new name is a rename, which takes the values along. A page's property one of its traits has,
 * renamed or given another type, is asked about first (`traitChanges`): on the trait, so every page having it
 * follows, or on this page alone, which then no longer has the trait.
 */
export function updateProperty(target: SchemaTarget, name: string, patch: Partial<PropertyDefinition>) {
  const schema = schemaOf(target);
  if (patch.name && !sameName(patch.name, name) && findProperty(schema, patch.name)) return;
  const renames = patch.name && patch.name !== name ? { [name]: patch.name } : undefined;
  const here = () =>
    write(
      target,
      schema.map((p) => (p.name === name ? { ...p, ...patch } : p)),
      { renames },
    );
  const before = schema.find((p) => p.name === name);
  const breaks = !!renames || (patch.type !== undefined && patch.type !== before?.type);
  const having = breaks ? traitsHaving(target, name) : [];
  if (!having.length) return here();
  traitChanges.ask({
    what: renames ? "rename" : "retype",
    property: name,
    to: patch.name ?? patch.type ?? "",
    traits: having,
    here,
    onTrait: (trait) =>
      void traits.update(trait.id, {
        properties: trait.properties.map((p) => (sameName(p.name, name) ? { ...p, ...patch } : p)),
        ...(renames && {
          renames: { [findProperty(trait.properties, name)?.name ?? name]: patch.name ?? name },
        }),
      }),
  });
}

/**
 * Deletes a property with its values. From a page: when one of its traits has it, asked first (from the trait and
 * every page having it, or from this page alone). From a trait: asked whether its pages keep it.
 */
/**
 * Limits a relation to pages having one of `ids` (any page when empty). Links to pages that no longer fit are dropped
 * from every page the property is on, after asking.
 */
export function setAllowedTraits(target: SchemaTarget, name: string, ids: readonly string[]) {
  const fits = (id: string) => {
    const page = local.page(id);
    return !ids.length || (!!page && local.traitIds(page).some((t) => ids.includes(t)));
  };
  const holders =
    "page" in target
      ? [local.page(target.page)].filter((p) => !!p)
      : pageRecords.all.filter((p) => local.traitIds(p).includes(target.trait));
  const drops = holders.flatMap((page) => {
    const key = findProperty(page.schema, name)?.name ?? name;
    const value = page.properties[key];
    if (!Array.isArray(value)) return [];
    const kept = (value as string[]).filter(fits);
    return kept.length < value.length ? [{ page: page.id, key, kept, lost: value.length - kept.length }] : [];
  });
  const apply = () =>
    synced.transaction(() => {
      updateProperty(target, name, { traits: [...ids], trait: undefined });
      for (const drop of drops) pages.setProperty(drop.page, drop.key, drop.kept.length ? drop.kept : null);
    });
  if (!drops.length) return apply();
  const lost = drops.reduce((n, d) => n + d.lost, 0);
  const where = drops.length === 1 ? "" : ` across ${drops.length} pages`;
  confirm.show(
    `${lost} ${lost === 1 ? "link" : "links"} in ${name}${where} point to pages without these traits and will be removed.`,
    "Remove",
    apply,
    true,
  );
}

export function removeProperty(target: SchemaTarget, name: string) {
  const rest = schemaOf(target).filter((p) => p.name !== name);
  if ("trait" in target) {
    const trait = traits.get(target.trait);
    if (!trait?.pages) return write(target, rest, { drop: [name] });
    traitChanges.ask({
      what: "drop",
      property: name,
      to: "",
      traits: [trait],
      here: () => write(target, rest, { drop: [name] }),
      onTrait: () => write(target, rest, { drop: [name], dropFromPages: true }),
    });
    return;
  }
  const having = traitsHaving(target, name);
  if (!having.length) return write(target, rest);
  traitChanges.ask({
    what: "delete",
    property: name,
    to: "",
    traits: having,
    here: () => write(target, rest),
    onTrait: (trait) =>
      void traits.update(trait.id, {
        drop: [findProperty(trait.properties, name)?.name ?? name],
        dropFromPages: true,
      }),
  });
}

export function moveProperty(target: SchemaTarget, name: string, before: string | null) {
  const schema = schemaOf(target);
  const moving = schema.find((p) => p.name === name);
  if (!moving) return;
  const rest = schema.filter((p) => p.name !== name);
  const index = before ? rest.findIndex((p) => p.name === before) : rest.length;
  write(target, [...rest.slice(0, index), moving, ...rest.slice(index)]);
}
