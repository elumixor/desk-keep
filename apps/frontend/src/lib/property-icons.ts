import {
  AlignLeft,
  ArrowUpRight,
  Calendar,
  CircleCheck,
  CircleChevronDown,
  Hash,
  Link2,
  List,
  Puzzle,
  Sigma,
  SquareMousePointer,
  User,
} from "lucide-svelte";
import type { PropertyType } from "$model/properties";

/** One icon per property type, wherever a property is named: the page's panel, a table header, the add menu. */
export const PROPERTY_ICONS: Record<PropertyType, typeof Hash> = {
  text: AlignLeft,
  number: Hash,
  select: CircleChevronDown,
  multi_select: List,
  date: Calendar,
  person: User,
  relation: ArrowUpRight,
  checkbox: CircleCheck,
  url: Link2,
  formula: Sigma,
  extension: Puzzle,
  button: SquareMousePointer,
};

/** The same icons by lucide name, for where a component cannot be drawn (a script's editor draws text only). */
export const PROPERTY_ICON_NAMES: Record<PropertyType, string> = {
  text: "align-left",
  number: "hash",
  select: "circle-chevron-down",
  multi_select: "list",
  date: "calendar",
  person: "user",
  relation: "arrow-up-right",
  checkbox: "circle-check",
  url: "link-2",
  formula: "sigma",
  extension: "puzzle",
  button: "square-mouse-pointer",
};

export const propertyTypeLabel = (type: PropertyType) =>
  type === "multi_select" ? "Multi-select" : type[0]?.toUpperCase() + type.slice(1);
