import { isSelect } from "./options";
import {
  type DateValue,
  findProperty,
  type PropertyDefinition,
  type PropertyValue,
  type PropertyValues,
  type Schema,
  type SelectOption,
  sameName,
  sameType,
} from "./properties";

/**
 * A value carried across a change of its property's type: read as text, then parsed as the new type. Selects gain the
 * options the text names, so `to` comes back with them. Pure: the page write and the trait change both use it.
 */

const optionName = (definition: PropertyDefinition, id: string) => definition.options?.find((o) => o.id === id)?.name;

/** The value as words, the common ground every type is read back from. */
function asTexts(definition: PropertyDefinition, value: PropertyValue): string[] {
  if (value === null || value === undefined) return [];
  switch (definition.type) {
    case "select":
      return [optionName(definition, String(value)) ?? ""].filter(Boolean);
    case "multi_select":
      return (value as string[]).flatMap((id) => optionName(definition, id) ?? []);
    case "date": {
      const { start, end } = value as DateValue;
      return [end ? `${start} – ${end}` : start];
    }
    case "checkbox":
      return value ? ["Yes"] : [];
    case "person":
    case "relation":
    case "extension":
      return [];
    default:
      return [String(value)].filter(Boolean);
  }
}

const TRUE = new Set(["yes", "true", "1", "x", "y", "on", "done", "✓"]);
const COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink", "brown"];

/** Options named `names` in `to`, adding those it lacks; the ids picked, and `to` with any new options. */
function pick(to: PropertyDefinition, names: string[]) {
  const options: SelectOption[] = [...(to.options ?? [])];
  const ids = names.map((name) => {
    const found = options.find((o) => sameName(o.name, name));
    if (found) return found.id;
    const option = { id: crypto.randomUUID(), name, color: COLORS[options.length % COLORS.length] };
    options.push(option);
    return option.id;
  });
  return { ids, to: options.length === (to.options?.length ?? 0) ? to : { ...to, options } };
}

/** A select's value naming `names` (a single select the first of them), and `to` with any options it gained. */
function selectValue(to: PropertyDefinition, names: string[]) {
  const picked = pick(to, to.type === "select" ? names.slice(0, 1) : names);
  return { value: to.type === "select" ? picked.ids[0] : picked.ids, to: picked.to };
}

function parseDate(text: string): DateValue | undefined {
  const [start, end] = text.split(/\s+[–-]\s+/).map((part) => {
    const iso = part.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (iso) return iso;
    const time = Date.parse(part);
    return Number.isNaN(time) ? undefined : new Date(time).toISOString().slice(0, 10);
  });
  return start ? { start, ...(end && { end }) } : undefined;
}

function coerceValue(
  from: PropertyDefinition,
  to: PropertyDefinition,
  value: PropertyValue | undefined,
): { value: PropertyValue | undefined; to: PropertyDefinition } {
  if (value === undefined || value === null) return { value: undefined, to };
  // Lists of the same things keep their items.
  if (isSelect(from) && isSelect(to)) return selectValue(to, asTexts(from, value));
  if ((from.type === "person" || from.type === "relation") && from.type === to.type) return { value, to };
  const texts = asTexts(from, value);
  const text = texts.join(", ");
  switch (to.type) {
    case "text":
      return { value: text || undefined, to };
    case "url":
      return { value: URL.canParse(text) ? text : undefined, to };
    case "number": {
      const number = Number.parseFloat(text.replace(/[^\d.eE+-]/g, ""));
      return { value: Number.isFinite(number) ? number : undefined, to };
    }
    case "checkbox":
      return { value: TRUE.has(text.trim().toLowerCase()), to };
    case "date":
      return { value: parseDate(text), to };
    case "select":
    case "multi_select": {
      const names = (to.type === "select" ? [text] : texts.flatMap((t) => t.split(",")))
        .map((n) => n.trim())
        .filter(Boolean);
      return names.length ? selectValue(to, names) : { value: undefined, to };
    }
    default:
      return { value: undefined, to };
  }
}

/** A page's values carried into a schema whose properties may have changed type (matched by name, after renames). */
export function coerceValues(
  before: Schema,
  after: Schema,
  values: PropertyValues,
): { schema: Schema; values: PropertyValues } {
  const out: Record<string, PropertyValue> = { ...values };
  const schema = after.map((definition) => {
    const old = findProperty(before, definition.name);
    if (!old || sameType(old, definition) || !(old.name in values)) return definition;
    const coerced = coerceValue(old, definition, values[old.name]);
    delete out[old.name];
    if (coerced.value !== undefined) out[definition.name] = coerced.value;
    return coerced.to;
  });
  return { schema, values: out };
}
