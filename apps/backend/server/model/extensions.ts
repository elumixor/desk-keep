import { z } from "zod";

/**
 * What an extension serves: its manifest (property types and actions), the options of a property type, and what an
 * action answers. Keep never knows an extension by name; everything it shows comes from these.
 */

const FIELD_TYPES = ["checkbox", "text", "number"] as const;

const extensionFieldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  default: z.union([z.boolean(), z.string(), z.number()]).optional(),
});

const extensionPropertyTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** A lucide icon name. */
  icon: z.string().optional(),
  multiple: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  /** `GET <options>?q=` answers the values to pick from; a type without one is written by the app only. */
  options: z.url().optional(),
  fields: z.array(extensionFieldSchema).optional(),
});
export type ExtensionPropertyType = z.infer<typeof extensionPropertyTypeSchema>;

const extensionActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  appliesTo: z.string().optional(),
  endpoint: z.url(),
});
export type ExtensionAction = z.infer<typeof extensionActionSchema>;

export const manifestSchema = z.object({
  name: z.string().min(1),
  /** An image URL. */
  icon: z.string().optional(),
  propertyTypes: z.array(extensionPropertyTypeSchema).default([]),
  actions: z.array(extensionActionSchema).default([]),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const extensionOptionSchema = z.object({
  urn: z.string().regex(/^[a-z][a-z0-9-]*:.+$/, "Not a URN"),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
});
export type ExtensionOption = z.infer<typeof extensionOptionSchema>;

export const actionAnswerSchema = z.object({
  ok: z.boolean().default(true),
  message: z.string().optional(),
  set: z.record(z.string(), z.unknown()).optional(),
  open: z.url().optional(),
});
export type ActionAnswer = z.infer<typeof actionAnswerSchema>;

/** A lucide icon name is lower-case words joined by dashes; anything else is not drawn. */
export const isIconName = (icon: string | undefined): icon is string => !!icon && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon);

/** The field values a freshly picked value starts with: the property's own, else the manifest's defaults. */
export function defaultFields(
  type: ExtensionPropertyType | undefined,
  configured: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  const fields: Record<string, unknown> = {};
  for (const field of type?.fields ?? []) if (field.default !== undefined) fields[field.id] = field.default;
  Object.assign(fields, configured);
  return Object.keys(fields).length ? fields : undefined;
}
