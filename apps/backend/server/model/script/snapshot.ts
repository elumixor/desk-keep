import { formulaResult, optionNames, type PropertyDefinition, type PropertyValue, type Schema } from "../properties";

/** What a page is read from, on the server (a row) or in the browser (a synced record). */
interface SnapshotSource {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly schema: Schema;
  readonly properties: Readonly<Record<string, PropertyValue>>;
}

/** A page as the script's `Page` is built from (the prelude): values as they read, a relation's as page ids. */
export interface Snapshot {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly properties: readonly { readonly name: string; readonly type: string; readonly value: unknown }[];
}

/** A value as a script reads it: a select's option by name, a checkbox never missing. */
export function readValue(definition: PropertyDefinition, value: PropertyValue | undefined): unknown {
  switch (definition.type) {
    case "select":
      return value == null ? null : (optionNames(definition, value)[0] ?? null);
    case "multi_select":
      return value == null ? [] : optionNames(definition, value);
    case "checkbox":
      return value === true;
    case "person":
    case "relation":
      return value ?? [];
    case "extension":
      return value ?? (definition.multiple ? [] : null);
    case "formula": {
      const result = formulaResult(definition, value);
      return result ? readValue(result.definition, result.value) : null;
    }
    default:
      return value ?? null;
  }
}

/** A page as its script reads it. */
export const snapshot = (page: SnapshotSource): Snapshot => ({
  id: page.id,
  title: page.title,
  parentId: page.parentId,
  properties: page.schema.map((p) => ({ name: p.name, type: p.type, value: readValue(p, page.properties[p.name]) })),
});
