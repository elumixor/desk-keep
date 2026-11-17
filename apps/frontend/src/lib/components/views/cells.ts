import type { View, ViewResult, ViewRow } from "$lib/api";
import { moveProperty, type SchemaTarget } from "$lib/schema";
import { updateView } from "$lib/views";
import type { PropertyDefinition, PropertyValue } from "$model/properties";
import { cellDefinition, TITLE } from "$model/views";

/** The columns a view shows: all of what it selects, or the ones it was told to, in the columns' order. */
export const shownColumns = (view: Pick<View, "visibleProperties">, result: ViewResult) =>
  result.columns.filter((c) => !view.visibleProperties || view.visibleProperties.includes(c.name));

/** Whose column it is to edit: the trait the view keeps to, when the trait has it; a page-only column has none. */
export function columnTarget(result: ViewResult, name: string): SchemaTarget | null {
  const trait = result.traits.find((t) => t.properties.some((p) => p.name === name));
  return trait ? { trait: trait.id } : null;
}

/** One row's cell of a column: its own definition when it has the property, and its value. */
export function cellOf(row: ViewRow, column: PropertyDefinition) {
  const own = cellDefinition(row, column);
  const definition = own ?? column;
  const value = row.properties[definition.name] as PropertyValue | undefined;
  /** `own`: the page has the property, so a value is written as is; otherwise it is given the column's definition. */
  return { definition, own: !!own, value };
}

/** Whether a cell has nothing to show: no value, an empty text, or an empty list (no people, options or pages). */
export const blank = (value: unknown) =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

/**
 * The shown columns' names in the order they stand, the title (`TITLE`) among them: where the view put it in its shown
 * properties (before the property listed after it), first when it has not.
 */
export function withTitle(view: Pick<View, "visibleProperties">, names: readonly string[]): string[] {
  const order = view.visibleProperties ?? [];
  const at = order.indexOf(TITLE);
  if (at < 0) return [TITLE, ...names];
  const after = order.slice(at + 1).find((n) => names.includes(n));
  const i = after ? names.indexOf(after) : names.length;
  return [...names.slice(0, i), TITLE, ...names.slice(i)];
}

/** Puts the title before `before` (last when null) among the shown properties `names`, in the order they stand. */
function placeTitle(view: View, names: readonly string[], before: string | null) {
  const list = names.filter((n) => n !== TITLE);
  const i = before && list.includes(before) ? list.indexOf(before) : list.length;
  void updateView(view, { visibleProperties: [...list.slice(0, i), TITLE, ...list.slice(i)] });
}

/**
 * A column dropped before another (last when null): the title moves in the view, a property in its trait (so every
 * view of it follows); a property dropped right before the title keeps the title after it.
 */
export function moveColumn(
  view: View,
  result: ViewResult,
  names: readonly string[],
  name: string,
  before: string | null,
) {
  if (name === TITLE) return placeTitle(view, names, before);
  const target = columnTarget(result, name);
  if (!target) return;
  if (before !== TITLE) return moveProperty(target, name, before);
  const order = withTitle(view, names);
  const next = order.slice(order.indexOf(TITLE) + 1).find((n) => n !== name) ?? null;
  moveProperty(target, name, next);
  placeTitle(
    view,
    names
      .filter((n) => n !== name)
      .toSpliced(next ? names.filter((n) => n !== name).indexOf(next) : names.length - 1, 0, name),
    next,
  );
}
