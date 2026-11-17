import type { Choice } from "$lib/components/ui/ChoiceList.svelte";
import { defaultFields, type Manifest } from "$model/extensions";
import { PROPERTY_TYPES, type PropertyDefinition, type PropertyType } from "$model/properties";
import { PROPERTY_ICONS, propertyTypeLabel } from "./property-icons";
import { extensions } from "./stores/extensions.svelte";

/** A type picked for a property: a built-in one, or an extension's property type. */
export interface TypePick {
  readonly type: PropertyType;
  readonly extra?: Partial<PropertyDefinition>;
}

const BUILT_IN = PROPERTY_TYPES.filter((t) => t !== "extension");
const BUILT_IN_GROUP = "Property type";

const typeValue = (extensionId: string, typeId: string) => `type:${extensionId}/${typeId}`;

const manifestOf = (extension: (typeof extensions.list)[number]) => extension.manifest as Manifest;

/** Every type a property can be: the built-in ones, then each extension's property types (its actions are called from buttons). */
export function typeChoices(): Choice[] {
  return [
    ...BUILT_IN.map((type) => ({
      value: type,
      label: propertyTypeLabel(type),
      icon: PROPERTY_ICONS[type],
      group: BUILT_IN_GROUP,
    })),
    ...extensions.list.flatMap((extension) =>
      manifestOf(extension).propertyTypes.map((type) => ({
        value: typeValue(extension.id, type.id),
        label: type.name,
        named: type.icon,
        group: extension.name,
      })),
    ),
  ];
}

/** What a choice of `typeChoices` makes. */
export function typePick(value: string): TypePick | undefined {
  const [kind, rest = ""] = value.split(":");
  const [extensionId, id] = rest.split("/");
  const extension = extensions.get(extensionId);
  if (kind === "type" && extension) {
    const type = manifestOf(extension).propertyTypes.find((t) => t.id === id);
    if (!type) return undefined;
    const fields = defaultFields(type, undefined);
    return {
      type: "extension",
      extra: {
        name: type.name,
        extension: extension.id,
        extType: type.id,
        ...(type.multiple && { multiple: true }),
        ...(fields && { fields }),
      },
    };
  }
  return (BUILT_IN as readonly string[]).includes(value) ? { type: value as PropertyType } : undefined;
}

/** The choice a property is now, to check it in the list. */
export const choiceOf = (definition: PropertyDefinition) =>
  definition.type === "extension" && definition.extension && definition.extType
    ? typeValue(definition.extension, definition.extType)
    : definition.type;

/** What a property's type is called: an extension's by its name there ("Dev project"). */
export const typeLabel = (definition: PropertyDefinition) =>
  definition.type === "extension"
    ? (extensions.typeOf(definition)?.name ?? "Extension")
    : propertyTypeLabel(definition.type);
