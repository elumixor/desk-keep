import { isWritten, type Schema } from "../properties";
import { LANGUAGE_TYPES } from "../script/language";
import { valueType } from "../script/types";

/** What a formula is given, as TypeScript declarations for its editor: `self` read only, with the page's own values. */
export function formulaTypes(schema: Schema) {
  const props = schema
    .filter((p) => isWritten(p) || p.type === "formula")
    .map((p) => `  readonly ${JSON.stringify(p.name)}: FormulaProperty<${valueType(p, "FormulaPage")}>;`)
    .join("\n");
  return `${LANGUAGE_TYPES}
/** A property as a formula reads it: its value, never written. */
interface FormulaProperty<T = unknown> {
  readonly name: string;
  readonly value: T;
}

/** A page as a formula reads it: its values, never written. */
interface FormulaPage<P extends object = Record<string, FormulaProperty>> {
  readonly id: string;
  readonly title: string;
  /** One of its properties, by name; a relation's value is its pages (whose own relations read empty). */
  prop<K extends keyof P & string>(name: K): P[K];
  /** All its properties. */
  readonly props: P[keyof P][];
  /** The pages right under it (under a related page or a child, none). */
  readonly children: FormulaPage[];
  /** The page it is under (above a related page or a child, none). */
  readonly parent: FormulaPage | null;
  /** Its title. */
  toString(): string;
}

/** The page's properties, by name. */
interface SelfProps {
${props}
}

/** The page the formula is computed on. */
declare const self: FormulaPage<SelfProps>;
`;
}
