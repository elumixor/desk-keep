import { z } from "zod";
import {
  type ExtensionValue,
  findProperty,
  formulaResult,
  optionNames,
  type PropertyDefinition,
  type PropertyValue,
  type PropertyValues,
  type Schema,
  sameType,
} from "./properties";
import type { TraitShape } from "./traits";

export const VIEW_KINDS = ["table", "board", "list", "timeline"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

/**
 * Keys a filter or sort may name besides properties (a property's name never starts with `$`): the title, when a page
 * was created or last changed, which traits it has (`$trait` is/is not a trait id), and where it sits: `$parent` is
 * the page right above it, `$under` any page above it.
 */
export const TITLE = "$title";
export const CREATED = "$created";
export const UPDATED = "$updated";
export const TRAIT = "$trait";
export const PARENT = "$parent";
export const UNDER = "$under";

export const FILTER_OPS = ["is", "is_not", "contains", "empty", "not_empty", "gt", "lt"] as const;

export const filterSchema = z.object({
  property: z.string().min(1),
  op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type Filter = z.infer<typeof filterSchema>;

export const sortSchema = z.object({ property: z.string().min(1), direction: z.enum(["asc", "desc"]) });
export type Sort = z.infer<typeof sortSchema>;

export const CLEANUP_MAX_DAYS = 3650;

/**
 * A view's cleanup rule: the pages it shows are archived once `property` has been `value` (as an `is` filter reads it:
 * an option's name, a number, a checkbox's "true") for `days` days (`lib/cleanup.ts`).
 */
export const cleanupSchema = z.object({
  property: z.string().min(1).max(200),
  value: z.string().max(500),
  days: z.number().int().min(0).max(CLEANUP_MAX_DAYS),
});
export type Cleanup = z.infer<typeof cleanupSchema>;

/** The filter a cleanup rule's condition is. */
export const cleanupFilter = (rule: Cleanup): Filter => ({ property: rule.property, op: "is", value: rule.value });

/**
 * A view's pages are the workspace's that have all of its `traits` (any page when none), kept by its filters, in its
 * order.
 */
export interface ViewQuery {
  readonly traits: readonly string[];
  readonly filter: readonly Filter[];
  readonly sort: readonly Sort[];
  /** JavaScript, as a formula's, whose value per page orders the view before `sort` (`sortKey`). */
  readonly sortCode?: string | null;
  /** Archived pages are shown too; left out otherwise (whoever loads the pages keeps them out). */
  readonly showArchived?: boolean;
  /** Overrides `showArchived` for an assistant's query: archived pages left out, shown too, or alone. */
  readonly archived?: ArchivedMode;
}

export const ARCHIVED_MODES = ["exclude", "include", "only"] as const;
export type ArchivedMode = (typeof ARCHIVED_MODES)[number];

/** Which archived pages a query keeps. */
export const archivedMode = (query: Pick<ViewQuery, "showArchived" | "archived">): ArchivedMode =>
  query.archived ?? (query.showArchived ? "include" : "exclude");

/** A page's value under a view's sort expression; `undefined` while it cannot be worked out. */
export type SortKey = (page: ScopedPage) => unknown;

export interface Row {
  readonly id: string;
  readonly parentId?: string | null;
  readonly title: string;
  readonly sort: number;
  /** What the view filters and sorts on. */
  readonly properties: PropertyValues;
  /** The definitions those values follow. */
  readonly schema: Schema;
  /** Ids of the traits the page has. */
  readonly traits?: readonly string[];
  readonly createdAt?: string;
  readonly updatedAt?: string;
  /** When it was archived; null or absent when it is not. */
  readonly archivedAt?: string | null;
}

type Comparable = string | number | boolean | null;

/** A value reduced to what a filter compares and a sort orders: option names, date starts, ids joined. */
function comparable(row: Row, property: string): Comparable {
  if (property === TITLE) return row.title;
  if (property === CREATED) return row.createdAt ?? null;
  if (property === UPDATED) return row.updatedAt ?? null;
  if (property === TRAIT) return row.traits?.join(",") || null;
  const definition = findProperty(row.schema, property);
  const value: PropertyValue | undefined = definition ? row.properties[definition.name] : undefined;
  if (!definition || value === undefined || value === null) return null;
  if (definition.type === "formula") {
    const result = formulaResult(definition, value);
    return result
      ? comparable({ ...row, schema: [result.definition], properties: { [property]: result.value } }, property)
      : null;
  }
  if (definition.type === "select") return definition.options?.find((o) => o.id === value)?.name ?? null;
  if (definition.type === "multi_select" && Array.isArray(value)) {
    const names = optionNames(definition, value);
    return names.length ? names.join(", ") : null;
  }
  if (definition.type === "date" && typeof value === "object" && "start" in value) return value.start;
  if (definition.type === "extension") {
    const labels = (Array.isArray(value) ? value : [value]).map((v) => (v as ExtensionValue).label);
    return labels.length ? labels.join(", ") : null;
  }
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === "string" ? v : v.id)).join(",") : null;
  return value as Comparable;
}

export function matches(row: Row, filter: Filter): boolean {
  // Where a page sits under another is worked out by whoever loads the pages (`underFilters`).
  if (filter.property === UNDER) return true;
  // A place filter whose page is not picked yet keeps every page.
  if (filter.property === PARENT && !filter.value) return true;
  if (filter.property === PARENT && (filter.op === "is" || filter.op === "is_not"))
    return (row.parentId === filter.value) === (filter.op === "is");
  if (filter.property === TRAIT && (filter.op === "is" || filter.op === "is_not"))
    return (row.traits ?? []).includes(String(filter.value ?? "")) === (filter.op === "is");
  const target = filter.value ?? null;
  // People and pages are a list: `is` asks whether the one picked is among them.
  const listed = findProperty(row.schema, filter.property);
  if ((listed?.type === "person" || listed?.type === "relation") && (filter.op === "is" || filter.op === "is_not")) {
    const value = row.properties[listed.name];
    const ids = Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : v.id)) : [];
    return ids.includes(String(target ?? "")) === (filter.op === "is");
  }
  const value = comparable(row, filter.property);
  switch (filter.op) {
    case "empty":
      return value === null || value === "";
    case "not_empty":
      return value !== null && value !== "";
    case "is":
      return String(value ?? "").toLowerCase() === String(target ?? "").toLowerCase();
    case "is_not":
      return String(value ?? "").toLowerCase() !== String(target ?? "").toLowerCase();
    case "contains":
      return String(value ?? "")
        .toLowerCase()
        .includes(String(target ?? "").toLowerCase());
    case "gt":
      return value !== null && target !== null && value > target;
    case "lt":
      return value !== null && target !== null && value < target;
  }
}

function compare(a: Comparable, b: Comparable): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Two sort-expression values in order: empty last, arrays key by key, numbers by size, the rest as text. */
function compareKeys(a: unknown, b: unknown): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const order = compareKeys(a[i], b[i]);
      if (order) return order;
    }
    return 0;
  }
  const x = a === undefined || a === "" ? null : a;
  const y = b === undefined || b === "" ? null : b;
  return compare(
    typeof x === "object" && x !== null ? JSON.stringify(x) : (x as Comparable),
    typeof y === "object" && y !== null ? JSON.stringify(y) : (y as Comparable),
  );
}

/**
 * The rows a view shows, in the order it shows them: by the sort expression's values (`keys`), then its sorts, then
 * the pages' own order, which is what dragging a row changes.
 */
function applyView<R extends Row>(
  rows: readonly R[],
  query: Pick<ViewQuery, "filter" | "sort">,
  keys?: ReadonlyMap<string, unknown>,
): R[] {
  const kept = rows.filter((row) => query.filter.every((filter) => matches(row, filter)));
  return kept.toSorted((a, b) => {
    if (keys) {
      const order = compareKeys(keys.get(a.id), keys.get(b.id));
      if (order) return order;
    }
    for (const { property, direction } of query.sort) {
      const [x, y] = [comparable(a, property), comparable(b, property)];
      const order = compare(x, y);
      // Empty values go last whichever way the view sorts.
      if (order !== 0) return direction === "asc" || x === null || y === null ? order : -order;
    }
    return a.sort - b.sort;
  });
}

/** The pages a view keeps to being under (`$under is <id>`): its loader narrows to their subtrees. */
export const underFilters = (query: Pick<ViewQuery, "filter">) =>
  query.filter
    .filter((f) => f.property === UNDER && f.op === "is" && typeof f.value === "string" && f.value)
    .map((f) => String(f.value));

/** A view of no trait that keeps to no place shows nothing, not every page of the workspace. */
export const selectsNothing = (query: Pick<ViewQuery, "traits" | "filter">) => !query.traits.length && !placeOf(query);

/** Where a view's filters put its pages (`$parent is` or `$under is`): the parent a page made in it is offered first. */
export const placeOf = (query: Pick<ViewQuery, "filter">) =>
  query.filter.find(
    (f) => (f.property === PARENT || f.property === UNDER) && f.op === "is" && typeof f.value === "string",
  )?.value as string | undefined;

/** One row's definition of a column, when it has the same property; a column it lacks shows empty. */
export const cellDefinition = (row: Pick<Row, "schema">, column: PropertyDefinition) => {
  const own = findProperty(row.schema, column.name);
  return own && sameType(own, column) ? own : undefined;
};

/**
 * The values a page created in a view starts with, so it shows there: each `is` filter on a property, as the value
 * the property takes (an option by its name, a number, a checkbox).
 */
export function prefilledValues(query: Pick<ViewQuery, "filter">, columns: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const filter of query.filter) {
    if (filter.op !== "is" || filter.property.startsWith("$") || filter.value === undefined || filter.value === "")
      continue;
    const column = findProperty(columns, filter.property);
    if (!column) continue;
    const value = filter.value;
    if (column.type === "number" && Number.isFinite(Number(value))) out[column.name] = Number(value);
    else if (column.type === "checkbox") out[column.name] = value === true || value === "true";
    else if (column.type === "multi_select") out[column.name] = [String(value)];
    else if (["text", "url", "select"].includes(column.type)) out[column.name] = String(value);
  }
  return out;
}

/** A page a view may show, as a query reads it: its values and definitions. */
export interface ScopedPage {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly icon: string | null;
  readonly sort: number;
  readonly properties: PropertyValues;
  readonly schema: Schema;
  /** Ids of the traits it has. */
  readonly traits: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string | null;
}

type ViewTrait = TraitShape & { readonly id: string; readonly name: string; readonly icon: string | null };

/**
 * What a query shows, given the pages that have its traits (and are under where it keeps to): the ones its filters
 * keep, in its order, and its columns: the properties of its traits, nothing a page has besides. Run by the server for an assistant and by the app on the records it holds.
 */
export function viewResult<T extends ViewTrait>(
  found: readonly ScopedPage[],
  traits: readonly T[],
  query: ViewQuery,
  sortKey?: SortKey,
) {
  const rows = found.map((page) => ({
    id: page.id,
    parentId: page.parentId,
    title: page.title,
    icon: page.icon,
    sort: page.sort,
    properties: page.properties,
    schema: page.schema,
    traits: page.traits,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    archivedAt: page.archivedAt ?? null,
  })) satisfies Row[];
  const keys = query.sortCode?.trim() && sortKey ? new Map(found.map((page) => [page.id, sortKey(page)])) : undefined;
  const shown = applyView(rows, query, keys);
  const kept = query.traits.map((id) => traits.find((t) => t.id === id)).filter((t): t is T => !!t);
  const traitProperties = kept
    .flatMap((t) => t.properties)
    .filter((p, i, all) => all.findIndex((q) => q.name.toLowerCase() === p.name.toLowerCase()) === i);
  return {
    traits: kept.map(({ id, name, icon, properties }) => ({ id, name, icon, properties })),
    columns: traitProperties,
    rows: shown,
  };
}

/** A trait's template: its child page of this title, whose body a new page having the trait starts with. */
export const TEMPLATE_TITLE = "Template";
