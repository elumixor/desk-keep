import { findProperty, type PropertyDefinition, type Schema } from "../properties";

/**
 * What a script assigns, turned into what the property holds where the meaning is plain and nothing is guessed from
 * text: a number or yes/no into text, yes/no into a number (1 or 0), a number into yes/no (0 is no), one page or person
 * into a list of them. A select takes only its options, and nothing is read out of a string; what else is assigned is
 * left as it is, for the property's own check to refuse.
 */

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

function coerced(definition: PropertyDefinition, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (definition.type) {
    case "text":
      return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
    case "number":
      return typeof value === "boolean" ? Number(value) : value;
    case "checkbox":
      return typeof value === "number" ? value !== 0 : value;
    case "relation":
    case "person":
      return asList(value);
    default:
      return value;
  }
}

/** Values a script writes, by property name, each turned into what its property holds where it can be. */
export function writtenValues(schema: Schema, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      const definition = findProperty(schema, name);
      return [name, definition ? coerced(definition, value) : value];
    }),
  );
}
