import {
  type PropertyDefinition,
  type PropertyValue,
  type PropertyValues,
  type Schema,
  type SelectOption,
  sameName,
} from "./properties";

/**
 * A select's options are shared by every select of its name in a workspace: "Status" means one list of options with
 * one id each, wherever a page or trait has it, so a board grouped by Status lines up across pages. Each definition
 * keeps a copy; a change to one copy is carried to the others. Pure.
 */

export const isSelect = (p: Pick<PropertyDefinition, "type">) => p.type === "select" || p.type === "multi_select";

/** What changed in one property's options: ones added, ones removed (by id), ones renamed or recoloured. */
export interface OptionChange {
  readonly name: string;
  readonly added: readonly SelectOption[];
  readonly removed: readonly string[];
  readonly changed: readonly SelectOption[];
}

export function optionChange(name: string, before: readonly SelectOption[], after: readonly SelectOption[]) {
  const change: OptionChange = {
    name,
    added: after.filter((o) => !before.some((b) => b.id === o.id)),
    removed: before.filter((b) => !after.some((o) => o.id === b.id)).map((b) => b.id),
    changed: after.filter((o) => {
      const was = before.find((b) => b.id === o.id);
      return was && (was.name !== o.name || was.color !== o.color);
    }),
  };
  return change.added.length || change.removed.length || change.changed.length ? change : null;
}

/** One copy of the options with a change made elsewhere: an option added once, removed, or renamed by id. */
function applyOptionChange(options: readonly SelectOption[], change: OptionChange): SelectOption[] {
  const out = options
    .filter((o) => !change.removed.includes(o.id))
    .map((o) => change.changed.find((c) => c.id === o.id) ?? o);
  for (const added of change.added)
    if (!out.some((o) => o.id === added.id || sameName(o.name, added.name))) out.push(added);
  return out;
}

/** A schema with a change made to the options of every select of that name in it; the same schema when none has it. */
export function withOptionChanges(schema: Schema, changes: readonly OptionChange[]): Schema {
  let touched = false;
  const out = schema.map((p) => {
    const change = isSelect(p) && changes.find((c) => sameName(c.name, p.name));
    if (!change) return p;
    touched = true;
    return { ...p, options: applyOptionChange(p.options ?? [], change) };
  });
  return touched ? out : schema;
}

/**
 * A select joining the workspace's list of its name: the shared options first, then its own whose names are new;
 * `ids` maps each of its own option ids to the one that stands for it now, for the values that name them.
 */
export function adoptOptions(own: readonly SelectOption[], shared: readonly SelectOption[]) {
  const options: SelectOption[] = [...shared];
  const ids = new Map<string, string>();
  for (const option of own) {
    const same = options.find((o) => o.id === option.id || sameName(o.name, option.name));
    if (same) ids.set(option.id, same.id);
    else options.push(option);
  }
  return { options, ids };
}

/** Values whose option ids were replaced (`adoptOptions`), for one property. */
export function remapValue(value: PropertyValue | undefined, ids: ReadonlyMap<string, string>) {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string"))
    return [...new Set((value as string[]).map((v) => ids.get(v) ?? v))];
  return value;
}

export const remapValues = (values: PropertyValues, name: string, ids: ReadonlyMap<string, string>): PropertyValues =>
  name in values ? { ...values, [name]: remapValue(values[name], ids) as PropertyValue } : values;
