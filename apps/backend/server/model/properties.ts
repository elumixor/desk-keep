import { z } from "zod";
import { groupUrl, pageUrl, personUrl } from "./urn";

export const PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "person",
  "relation",
  "checkbox",
  "url",
  "formula",
  "extension",
  "button",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** How a date property shows its dates. */
export const DATE_FORMATS = ["short", "long", "full", "numeric", "iso", "relative"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** How a number property shows its numbers: as written, as US dollars, or as minutes read as hours and minutes. */
export const NUMBER_FORMATS = ["plain", "usd", "minutes"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/** A number as its property's format reads it: `1234.5`, `$14.20`, `1h 12m`. */
export function formatNumber(value: number, format: NumberFormat = "plain"): string {
  if (format === "usd") return `$${value.toFixed(2)}`;
  if (format === "minutes") {
    const total = Math.round(value);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return hours ? (minutes ? `${hours}h ${minutes}m` : `${hours}h`) : `${minutes}m`;
  }
  return String(value);
}

const optionSchema = z.object({ id: z.string().min(1), name: z.string().min(1), color: z.string().optional() });
export type SelectOption = z.infer<typeof optionSchema>;

/** Names starting with `$` are a view's own keys (`$title`, `$trait`…), never a property's. */
const propertyName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((name) => !name.startsWith("$"), "A property name cannot start with $");

/**
 * A property is a name and a type, defined on a page (its own) or on a trait (every page that has the trait has it);
 * values are keyed by the name, in any case.
 */
export const propertyDefinitionSchema = z.object({
  name: propertyName,
  type: z.enum(PROPERTY_TYPES),
  /** An icon of its own (as `$model/icons` stores one), drawn instead of the type's. */
  icon: z.string().optional(),
  options: z.array(optionSchema).optional(),
  formula: z.string().optional(),
  /** For `extension`: which installed extension and which of its property types; `multiple` comes from its manifest. */
  extension: z.string().optional(),
  extType: z.string().optional(),
  multiple: z.boolean().optional(),
  /** For `extension`: the field values a newly picked value starts with. */
  fields: z.record(z.string(), z.unknown()).optional(),
  /** For `date`: how its dates read (`short` when absent). */
  dateFormat: z.enum(DATE_FORMATS).optional(),
  /** For `number`: how its numbers read (`plain` when absent). */
  numberFormat: z.enum(NUMBER_FORMATS).optional(),
  /** For `relation`: only pages that have one of these traits are offered (any page when empty). */
  traits: z.array(z.uuid()).optional(),
  /** Deprecated: the single trait a relation was limited to, before `traits`. */
  trait: z.uuid().optional(),
  /** For `button`: the text on it (the property's name when absent) and the TypeScript it runs (`lib/scripts`). */
  label: z.string().optional(),
  code: z.string().optional(),
});
export type PropertyDefinition = z.infer<typeof propertyDefinitionSchema>;

export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The traits a relation is limited to. */
export const allowedTraits = (definition: PropertyDefinition): readonly string[] =>
  definition.traits ?? (definition.trait ? [definition.trait] : []);

/** Whether a property's value is written by someone: a formula's is computed, and a button has none. */
export const isWritten = (definition: PropertyDefinition) =>
  definition.type !== "formula" && definition.type !== "button";

export const schemaSchema = z
  .array(propertyDefinitionSchema)
  .refine(
    (props) => new Set(props.map((p) => p.name.toLowerCase())).size === props.length,
    "Property names must be unique",
  );
/** The properties a page (or a trait) defines, in their order. */
export type Schema = readonly PropertyDefinition[];

/** The property of that name, in any case. */
export const findProperty = (schema: Schema, name: string) => schema.find((p) => sameName(p.name, name));

/** One property, as traits see it: same type, and for an extension the same extension's same type. */
export const sameType = (a: PropertyDefinition, b: PropertyDefinition) =>
  a.type === b.type && (a.type !== "extension" || (a.extension === b.extension && a.extType === b.extType));

/** Properties with some added or replaced (by name), in their order, new ones last. */
export function mergeSchema(current: Schema, add: Schema): Schema {
  const kept = current.map((p) => add.find((a) => sameName(a.name, p.name)) ?? p);
  return [...kept, ...add.filter((a) => !findProperty(current, a.name))];
}

/** Values with keys renamed (`{ old: new }`), for a property renamed on a page. */
export function renameValues<T>(values: Readonly<Record<string, T>>, renames: Readonly<Record<string, string>>) {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(values)) out[renames[key] ?? key] = value;
  return out;
}

/** A schema with properties renamed (`{ old: new }`, old names in any case). */
export function renameSchema(schema: Schema, renames: Readonly<Record<string, string>>): Schema {
  const entries = Object.entries(renames);
  return schema.map((p) => {
    const to = entries.find(([from]) => sameName(from, p.name))?.[1];
    return to ? { ...p, name: to } : p;
  });
}

/** Only what one page's values need: keys of properties it no longer has, and values a change of type broke, go. */
export function keepValid(schema: Schema, values: Readonly<Record<string, unknown>>): PropertyValues {
  const out: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(values)) {
    const definition = schema.find((p) => p.name === key);
    if (!definition || definition.type === "button" || value === null || value === undefined) continue;
    if (definition.type === "formula") {
      out[key] = value as PropertyValue;
      continue;
    }
    const parsed = valueSchema(definition).safeParse(value);
    if (parsed.success) out[key] = parsed.data as PropertyValue;
  }
  return out;
}

/** A person, or a group from People: what is assigned to a group without naming a member is its leader's. */
export const assigneeSchema = z.object({ kind: z.enum(["person", "group"]), id: z.string().uuid() });
export type Assignee = z.infer<typeof assigneeSchema>;

export const dateValueSchema = z.object({
  start: z.iso.datetime({ offset: true }).or(z.iso.date()),
  end: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
});
export type DateValue = z.infer<typeof dateValueSchema>;

/** A pointer into another app, picked from its options endpoint: what Keep shows is `label`, what it means is `urn`. */
const extensionValueSchema = z.object({
  urn: z.string().regex(/^[a-z][a-z0-9-]*:.+$/, "Not a URN"),
  label: z.string(),
  icon: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});
export type ExtensionValue = z.infer<typeof extensionValueSchema>;

/** A bare URN is taken as a value labelled with itself, so a script can write `"dev:session/42"`. */
const extensionValue = z.preprocess(
  (value) => (typeof value === "string" ? { urn: value, label: value } : value),
  extensionValueSchema,
);

/** What a formula's result is, by the property type it would be: a page's reference is a relation's value. */
export const FORMULA_RESULT_TYPES = ["text", "number", "checkbox", "date", "relation"] as const;
export type FormulaResultType = (typeof FORMULA_RESULT_TYPES)[number];
export const formulaResultSchema = z.object({ type: z.enum(FORMULA_RESULT_TYPES), value: z.unknown() });
/** A formula's result: its value as a property of its type holds it. */
export interface FormulaValue {
  readonly type: FormulaResultType;
  readonly value: PropertyValue;
}

/** A formula's value as the property its result is: drawn, read and compared as one, never written. */
export function formulaResult(definition: PropertyDefinition, value: unknown) {
  const parsed = formulaResultSchema.safeParse(value);
  return parsed.success
    ? {
        definition: { name: definition.name, type: parsed.data.type } as PropertyDefinition,
        value: parsed.data.value as PropertyValue,
      }
    : null;
}
export type PropertyValue =
  | string
  | number
  | boolean
  | readonly string[]
  | DateValue
  | readonly Assignee[]
  | ExtensionValue
  | readonly ExtensionValue[]
  | FormulaValue
  | null;
export type PropertyValues = Readonly<Record<string, PropertyValue>>;

export class InvalidPropertyError extends Error {
  constructor(
    readonly property: string,
    message: string,
  ) {
    super(`${property}: ${message}`);
    this.name = "InvalidPropertyError";
  }
}

function valueSchema(definition: PropertyDefinition): z.ZodType {
  const options = definition.options ?? [];
  // An option is written as its id or its name; it is kept as its id, so renaming an option changes no value.
  const option = z
    .string()
    .transform((value) => options.find((o) => o.id === value)?.id ?? options.find((o) => sameName(o.name, value))?.id)
    .refine((id) => id !== undefined, "Unknown option");
  switch (definition.type) {
    case "text":
      return z.string();
    case "number":
      return z.number().finite();
    case "select":
      return option;
    case "multi_select":
      return z.array(option);
    case "date":
      return dateValueSchema;
    case "person":
      return z.array(assigneeSchema);
    case "relation":
      return z.array(z.string().uuid());
    case "checkbox":
      return z.boolean();
    case "url":
      return z.url();
    case "formula":
      return formulaResultSchema;
    case "button":
      return z.never();
    case "extension":
      // One value or a list, as the manifest says; the other shape is accepted and turned into it.
      return definition.multiple
        ? z.preprocess((v) => (Array.isArray(v) ? v : [v]), z.array(extensionValue))
        : z.preprocess(
            (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v),
            extensionValue.refine((v) => !Array.isArray(v), "One value only"),
          );
  }
}

/**
 * Checks values written to a page against its schema, keyed by property name in any case (answered under the name as
 * defined). Unknown properties and writes to formulas are refused; `null` clears a value (kept as `null`, so a caller
 * merging the result knows to drop the key).
 */
export function validateValues(
  schema: Schema,
  values: Readonly<Record<string, unknown>>,
): Record<string, PropertyValue | null> {
  const out: Record<string, PropertyValue | null> = {};
  for (const [key, value] of Object.entries(values)) {
    const definition = findProperty(schema, key);
    if (!definition) throw new InvalidPropertyError(key, "No such property");
    if (definition.type === "formula")
      throw new InvalidPropertyError(definition.name, "A formula is computed, not written");
    if (definition.type === "button")
      throw new InvalidPropertyError(definition.name, "A button is pressed, not written");
    if (value === null) {
      out[definition.name] = null;
      continue;
    }
    const parsed = valueSchema(definition).safeParse(value);
    if (!parsed.success)
      throw new InvalidPropertyError(definition.name, parsed.error.issues[0]?.message ?? "Invalid value");
    out[definition.name] = parsed.data as PropertyValue;
  }
  return out;
}

/** The names of the options a select's value picks, in the options' order. */
export const optionNames = (definition: PropertyDefinition, value: PropertyValue) => {
  const ids: unknown[] = Array.isArray(value) ? value : [value];
  return (definition.options ?? []).filter((o) => ids.includes(o.id)).map((o) => o.name);
};

/** The text a property contributes to search: option names, not ids. */
export function propertyText(schema: Schema, values: PropertyValues): string {
  return schema
    .map((definition) => {
      const value = values[definition.name];
      if (value === undefined || value === null) return "";
      if (definition.type === "select" || definition.type === "multi_select")
        return optionNames(definition, value).join(" ");
      if (definition.type === "extension")
        return (Array.isArray(value) ? value : [value]).map((v) => (v as ExtensionValue).label).join(" ");
      if (definition.type === "formula") {
        const result = formulaResult(definition, value);
        return result ? propertyText([result.definition], { [definition.name]: result.value }) : "";
      }
      return ["text", "url", "number"].includes(definition.type) ? String(value) : "";
    })
    .filter(Boolean)
    .join(" ");
}

/** A value as a person reads it, for Markdown: option names, date ranges, people and pages by their addresses. */
export function displayValue(definition: PropertyDefinition, value: PropertyValue | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  switch (definition.type) {
    case "formula": {
      const result = formulaResult(definition, value);
      return result ? displayValue(result.definition, result.value) : "";
    }
    case "select":
    case "multi_select":
      return optionNames(definition, value).join(", ");
    case "date": {
      const date = value as DateValue;
      return date.end ? `${date.start} → ${date.end}` : date.start;
    }
    case "person":
      return (value as Assignee[]).map((a) => (a.kind === "group" ? groupUrl(a.id) : personUrl(a.id))).join(", ");
    case "relation":
      return (value as string[]).map(pageUrl).join(", ");
    case "checkbox":
      return value ? "yes" : "no";
    case "extension":
      return (Array.isArray(value) ? value : [value])
        .map((v) => `${(v as ExtensionValue).label} (${(v as ExtensionValue).urn})`)
        .join(", ");
    default:
      return String(value);
  }
}
