import {
  findProperty,
  type PropertyDefinition,
  type PropertyType,
  type PropertyValues,
  sameName,
} from "$model/properties";
import type { PageRecord, ViewRecord } from "$model/sync";
import { sortBefore } from "$model/tree";
import {
  type Cleanup,
  type Filter,
  PARENT,
  placeOf,
  prefilledValues,
  type Sort,
  TEMPLATE_TITLE,
  type ViewKind,
} from "$model/views";
import { createPage, newPageRecord } from "./actions";
import { api } from "./api";
import { newDefinition } from "./schema";
import { notices } from "./stores/notices.svelte";
import { traits } from "./stores/traits.svelte";
import { pageRecords, synced, viewRecords } from "./sync/client.svelte";
import { local } from "./sync/local.svelte";

interface ViewPatch {
  readonly kind?: ViewKind;
  readonly traits?: string[];
  readonly filter?: Filter[];
  readonly sort?: Sort[];
  readonly groupBy?: string | null;
  readonly visibleProperties?: string[] | null;
  readonly barProperties?: string[] | null;
  readonly sortCode?: string | null;
  readonly newParent?: string | null;
  readonly showArchived?: boolean;
  readonly cleanup?: Cleanup | null;
}

/** A view's settings change on screen at once, and what it selects with them. */
export function updateView(view: ViewRecord, patch: ViewPatch) {
  viewRecords.update(view.id, patch);
}

const NAMES: Record<ViewKind, string> = { table: "Table", board: "Board", list: "List", timeline: "Timeline" };

/**
 * A new view node under a page; `like` is a view whose pages it shows too (its traits and filters), `under` a page
 * whose children it keeps to (new pages going there too).
 */
export async function createView(
  parentId: string,
  kind: ViewKind,
  options: {
    groupBy?: string | null;
    like?: ViewRecord;
    traits?: string[];
    under?: string;
    open?: boolean;
    title?: string;
  } = {},
) {
  const like = options.like;
  return createPage(parentId, {
    kind: "view",
    title: options.title ?? NAMES[kind],
    open: options.open ?? false,
    view: {
      kind,
      traits: options.traits ?? like?.traits ?? [],
      filter: options.under ? [{ property: PARENT, op: "is", value: options.under }] : (like?.filter ?? []),
      groupBy: options.groupBy ?? null,
      newParent: options.under ?? like?.newParent ?? null,
    },
  });
}

/** Where a page made in a view goes without asking: the view's choice; `null` when it is to be asked. */
export const chosenParent = (view: ViewRecord) =>
  view.newParent && local.page(view.newParent) ? view.newParent : null;

/** The parent offered first when asking: where the view's filters look, else the view itself. */
export const suggestedParent = (view: ViewRecord) => {
  const place = placeOf(view);
  return place && local.page(place) ? place : view.id;
};

/**
 * "New" in a view: a page under `parentId`, given the properties of the view's traits and the values its `is` filters
 * ask for, with any values given on top (a board column's option, say) — so it shows there the moment it is made.
 */
export function createInView(
  view: ViewRecord,
  parentId: string,
  values: Record<string, unknown> = {},
  /** The sibling it goes before (last when null); after the parent's other children when not given. */
  before?: string | null,
): PageRecord | null {
  const result = local.viewResult(view.id);
  if (!result) return null;
  const fromTraits = result.traits.flatMap((t) => t.properties);
  const wanted = { ...prefilledValues(view, result.columns), ...values };
  // A value for a column no trait brings is given its property on the new page.
  const extra = Object.keys(wanted).flatMap((name) => {
    const column = findProperty(result.columns, name);
    return column && !findProperty(fromTraits, name) ? [column] : [];
  });
  const schema = [...fromTraits, ...extra].filter((p, i, all) => all.findIndex((q) => sameName(q.name, p.name)) === i);
  const template = result.traits.length === 1 ? templateOf(result.traits[0].id) : undefined;
  return pageRecords.create(
    newPageRecord(parentId, {
      body: template?.body ?? null,
      properties: asStored(schema, wanted) as PropertyValues,
      schema,
      traits: result.traits.map((t) => t.id),
      ...(before !== undefined && { sort: sortBefore(local.childrenOf(parentId), before) }),
    }),
  );
}

/** A trait's template: the child page whose body its new pages start with. */
export const templateOf = (traitId: string) =>
  local.childrenOf(traitId).find((c) => c.kind === "page" && c.title === TEMPLATE_TITLE);

/** Values as a page keeps them: an option named by its name is kept by its id. */
function asStored(schema: readonly PropertyDefinition[], values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const definition = findProperty(schema, key);
    if (!definition) continue;
    const option = (v: unknown) => definition.options?.find((o) => o.id === v || sameName(o.name, String(v)))?.id ?? v;
    if (definition.type === "select") out[definition.name] = option(value);
    else if (definition.type === "multi_select" && Array.isArray(value)) out[definition.name] = value.map(option);
    else out[definition.name] = value;
  }
  return out;
}

/** A new trait of no properties for a view of none: under the view with its name and icon, and what the view shows. */
export async function createLinkedTrait(view: ViewRecord) {
  const node = local.page(view.id);
  const trait = await createPage(view.id, {
    kind: "trait",
    title: node?.title || undefined,
    icon: node?.icon,
    open: false,
  });
  updateView(view, { traits: [trait.id] });
}

/** A property added from a view's settings: to every trait the view shows, so all their pages get it. */
export function addLinkedProperty(view: ViewRecord, type: PropertyType, extra: Partial<PropertyDefinition> = {}) {
  const result = local.viewResult(view.id);
  if (!result?.traits.length) return;
  const definition = newDefinition(result.columns, type, extra);
  synced.transaction(() => {
    for (const trait of result.traits) traits.update(trait.id, { properties: [...trait.properties, definition] });
    if (view.visibleProperties) updateView(view, { visibleProperties: [...view.visibleProperties, definition.name] });
  });
  return definition;
}

/** A date property for a timeline, which then places its pages by it; a view of no trait gets a linked trait to hold it. */
export async function addTimelineDate(view: ViewRecord) {
  if (!view.traits.length) await createLinkedTrait(view);
  const definition = addLinkedProperty(view, "date", { name: "Date" });
  if (definition) updateView(view, { groupBy: definition.name });
}

/** A select property for a board, which then groups its pages by it; a view of no trait gets a linked trait to hold it. */
export async function addBoardGroup(view: ViewRecord) {
  if (!view.traits.length) await createLinkedTrait(view);
  const definition = addLinkedProperty(view, "select", { name: "Status" });
  if (definition) updateView(view, { groupBy: definition.name });
}

/** A column added in a view: to its first trait, so every page having it gets it. */
export async function addViewProperty(view: ViewRecord, definition: PropertyDefinition) {
  try {
    await synced.flush();
    const answer = await api.views(view.id).properties.$post({ definition });
    await synced.sync();
    return answer;
  } catch (error) {
    notices.error(error);
    return null;
  }
}
