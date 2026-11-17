import { z } from "zod";
import type { PropertyDefinition, PropertyType } from "../properties";

/** What `new Property(name, type, value)` asks for, before a page is made with it. */
export interface PropertyInput {
  readonly name: string;
  readonly type: string;
  readonly value?: unknown;
}

/** The types a script may define a property of: none computed, pressed or an extension's. */
export const DEFINABLE_TYPES = [
  "text",
  "number",
  "checkbox",
  "select",
  "multi_select",
  "date",
  "url",
  "relation",
] as const;
const definable = new Set<string>(DEFINABLE_TYPES);

export class PropertyDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertyDefinitionError";
  }
}

/** A property a script defines (`new Property`), with a select's options taken from the names its value picks. */
export function definedProperty({ name, type, value }: PropertyInput): PropertyDefinition {
  if (!definable.has(type)) throw new PropertyDefinitionError(`A script cannot define a ${type} property`);
  const definition = { name, type: type as PropertyType };
  if (type !== "select" && type !== "multi_select") return definition;
  const names = [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(String))];
  return { ...definition, options: names.map((option) => ({ id: crypto.randomUUID(), name: option })) };
}

/** What a page a script makes is made from (`new Page`, `copy()`), once it is added under one. */
export const pageDraftSchema = z.object({
  title: z.string().max(500),
  traits: z.array(z.string().max(500)).max(50).default([]),
  properties: z
    .array(z.object({ name: z.string().min(1).max(200), type: z.string(), value: z.unknown() }))
    .max(200)
    .default([]),
  /** The page it copies: its properties, icon and text, under the draft's title. */
  copyOf: z.uuid().optional(),
});
export type PageDraft = z.infer<typeof pageDraftSchema>;

/** A draft's own properties, defined, and its values by name. */
export const draftProperties = (draft: PageDraft) => ({
  schema: draft.properties.map(definedProperty),
  values: Object.fromEntries(draft.properties.filter((p) => p.value != null).map((p) => [p.name, p.value])),
});
