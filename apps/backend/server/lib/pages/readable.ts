import { dateValueSchema, formulaResult, type PropertyValues, type Schema } from "~/model/properties";

/** A value as the words a reader would use for it, or nothing when the type has no text of its own. */
function readable(definition: Schema[number], value: unknown): string | null {
  switch (definition.type) {
    case "text":
    case "url":
      return typeof value === "string" && value ? value : null;
    case "number":
      return typeof value === "number" ? String(value) : null;
    case "checkbox":
      return typeof value === "boolean" ? (value ? "yes" : "no") : null;
    case "select": {
      const option = definition.options?.find((o) => o.id === value || o.name === value);
      return option?.name ?? null;
    }
    case "multi_select": {
      if (!Array.isArray(value)) return null;
      const names = value.map((v) => definition.options?.find((o) => o.id === v || o.name === v)?.name).filter(Boolean);
      return names.length ? names.join(", ") : null;
    }
    case "date": {
      const parsed = dateValueSchema.safeParse(value);
      if (!parsed.success) return null;
      return parsed.data.end ? `${parsed.data.start} – ${parsed.data.end}` : parsed.data.start;
    }
    case "formula": {
      const result = formulaResult(definition, value);
      return result ? readable(result.definition, result.value) : null;
    }
    default:
      return null;
  }
}

/** The page's property values that read as text, by name: what a model or a person can take in without lookups. */
export function readableProperties(schema: Schema, values: PropertyValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const definition of schema) {
    const text = readable(definition, values[definition.name]);
    if (text !== null) out[definition.name] = text;
  }
  return out;
}
