import type { Manifest } from "../extensions";
import { isWritten, type PropertyDefinition, type Schema } from "../properties";
import { DEFINABLE_TYPES } from "./define";
import { LANGUAGE_TYPES } from "./language";
import { methodOf, type Named, namespaces, selectRef } from "./names";

/**
 * What a button's script is given, as TypeScript declarations for the editor: the API every script has (what the
 * prelude in `lib/scripts` builds), the page's own properties with the values they read as, and a method per action of
 * each installed extension.
 */

const API = `
/** A page of the workspace, or one to be made (\`new Page\`, \`copy()\`), made when added to some page's children. */
declare class Page<P extends object = Record<string, Property>> {
  constructor(init?: { title?: string; traits?: readonly string[]; properties?: readonly Property[] });
  readonly id: string;
  /** Its address, \`https://keep.example.com/p/<id>\`: link it in Markdown as \`[title](url)\`. */
  readonly url: string;
  readonly title: string;
  /** The page it is under; null for a workspace. */
  readonly parent: Page | null;
  /** One of its properties, by name: read its \`value\`, or assign one to write it (null clears it). */
  prop<K extends keyof P & string>(name: K): P[K];
  /** All its properties. */
  readonly props: P[keyof P][];
  /** The pages right under it: \`add\` one here, \`remove\` one to the trash. */
  readonly children: Children;
  /** A copy of it (title, properties, text), made when added to some page's children. */
  copy(): Page<P>;
  /** Its title. */
  toString(): string;
}

interface Children extends Array<Page> {
  /** Puts a page here: moves it, or makes it when it is new. */
  add<T extends Page<object>>(page: T): T;
  /** Moves a page to the trash. */
  remove(page: Page<object>): void;
}

/**
 * A property: of a page (\`page.prop("Status")\`), its value read as \`R\` and written from \`W\`; or of a page to be
 * made (\`new Property(name, type, value)\`, a select's options the names it picks).
 */
declare class Property<R = unknown, W = R> {
  constructor(name: string, type: ${DEFINABLE_TYPES.map((t) => JSON.stringify(t)).join(" | ")}, value?: W);
  readonly name: string;
  readonly type: string;
  get value(): R;
  set value(value: W);
  /** \`Name: value\` */
  toString(): string;
}

/** What an extension's action answered (a refusal throws); its \`message\` and \`open\` reach whoever pressed the button. */
interface ActionResult { message?: string; open?: string; set?: Record<string, unknown> }

/** The page whose button was pressed. */
declare const self: Page<ThisProps>;
/** The workspace: the page every other is under. */
declare const workspace: Page;
/** A page by id, address or exact title; throws when there is none. */
declare function page(ref: string): Page;
/** The workspace's pages whose title matches, best first. */
declare function findPages(query: string): Page[];
/** Opens a URL in a new tab for whoever pressed the button. */
declare function open(url: string): void;
/** Shows a message to whoever pressed the button. */
declare function notify(message: string): void;
/** The options of a select (or multi-select) property, to ask for one of: \`select("<page id>/<property>")\`. */
interface Select<T extends string = string> { readonly options: readonly T[] }
/** What \`ask\` asks for: text, a number, yes or no, a date, one of some options, or one of a select's. */
type AskKind = "text" | "number" | "checkbox" | "date" | readonly string[] | Select;
/** What an \`ask\` of that kind answers: a date as \`YYYY-MM-DD\`. */
type Asked<K> = K extends "number" ? number : K extends "checkbox" ? boolean : K extends readonly (infer T)[] ? T : K extends Select<infer T> ? T : string;
/**
 * Asks whoever pressed: text, or what \`kind\` says (\`"number"\`, \`"checkbox"\`, \`"date"\`, \`["A", "B"]\` or
 * \`select(…)\`). Ask before changing anything: the script runs again once answered.
 */
declare function ask<const K extends AskKind = "text">(question: string, kind?: K): Asked<K>;
/** Writes to the output under the code, and the browser's console. */
declare function log(...values: unknown[]): void;
declare const console: {
  log(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
};
`;

const quote = (text: string) => JSON.stringify(text);
const doc = (text: string) => `/** ${text.replaceAll("*/", "* /")} */`;

/** The type a property's value reads as; a relation as the pages `page` names. */
export function valueType(definition: PropertyDefinition, page = "Page") {
  const options = definition.options?.length ? definition.options.map((o) => quote(o.name)).join(" | ") : "string";
  switch (definition.type) {
    case "text":
    case "url":
      return "string | null";
    case "number":
      return "number | null";
    case "checkbox":
      return "boolean";
    case "select":
      return `${options} | null`;
    case "multi_select":
      return `(${options})[]`;
    case "date":
      return "DateValue | null";
    case "person":
      return "Person[]";
    case "relation":
      return `${page}[]`;
    case "formula":
      return `number | string | boolean | DateValue | ${page}[] | null`;
    case "extension":
      return definition.multiple ? "ExtensionValue[]" : "ExtensionValue | null";
    case "button":
      return "never";
  }
}

/** What a property also takes when written, turned into its value (\`model/script/written.ts\`). */
function writeType(definition: PropertyDefinition, read: string) {
  switch (definition.type) {
    case "text":
      return "string | number | boolean | null";
    case "number":
      return "number | boolean | null";
    case "checkbox":
      return "boolean | number | null";
    case "url":
      return "string | null";
    case "relation":
      return "readonly (Page<object> | string)[] | Page<object> | string | null";
    case "person":
      return "readonly Person[] | Person | null";
    default:
      return `${read} | null`;
  }
}

function thisProps(schema: Schema) {
  const props = schema
    .filter(isWritten)
    .map((p) => {
      const read = valueType(p);
      return `  ${quote(p.name)}: Property<${read}, ${writeType(p, read)}>;`;
    })
    .join("\n");
  return `
/** The pressed page's properties, by name: each read as it is, written from anything plainly meaning one. */
interface ThisProps {
${props}
}
`;
}

/** A select property a script can name with `select("<page id>/<property>")`, to ask for one of its options. */
export interface ScriptSelect {
  readonly ref: string;
  /** Its page and name, as the editor draws the reference. */
  readonly label: string;
  readonly options: readonly string[];
}

/** The selects of some pages (traits, the pressed page), each once, named `<page> › <property>`. */
export const scriptSelects = (
  pages: readonly { readonly id: string; readonly name: string; readonly schema: Schema }[],
): ScriptSelect[] => [
  ...new Map(
    pages.flatMap((page) =>
      page.schema
        .filter((p) => p.type === "select" || p.type === "multi_select")
        .map((p): [string, ScriptSelect] => {
          const ref = selectRef(page.id, p.name);
          return [
            ref,
            { ref, label: `${page.name || "Untitled"} › ${p.name}`, options: (p.options ?? []).map((o) => o.name) },
          ];
        }),
    ),
  ).values(),
];

/** The workspace's selects by reference, so `select("…")` reads as the union of that select's options. */
function selectTypes(selects: readonly ScriptSelect[]) {
  const entries = selects
    .map((s) => `  ${quote(s.ref)}: ${s.options.length ? s.options.map(quote).join(" | ") : "string"};`)
    .join("\n");
  return `
interface Selects {
${entries}
}
/** A select's options, by \`<page id>/<property>\`, to ask for one of them. */
declare function select<K extends keyof Selects>(ref: K): Select<Selects[K]>;
declare function select(ref: string): Select;
`;
}

export interface ScriptExtension extends Named {
  readonly manifest: Manifest;
}

function extensionTypes(extensions: readonly ScriptExtension[]) {
  const names = namespaces(extensions);
  const members = extensions.map((extension) => {
    const methods = extension.manifest.actions
      .map((a) => `    ${doc(a.label)}\n    ${methodOf(a.id)}(target?: Page<object>): ActionResult;`)
      .join("\n");
    return { namespace: names.get(extension.id), body: `{\n${methods}\n  }`, name: extension.name };
  });
  const ext = members.map(
    (m) =>
      `  ${doc(`${m.name}: its actions, each on a page (this one when none is given).`)}\n  readonly ${m.namespace?.name}: ${m.body};`,
  );
  const globals = members
    .filter((m) => m.namespace?.global)
    .map((m) => `declare const ${m.namespace?.name}: typeof ext.${m.namespace?.name};`);
  return `\n/** The workspace's extensions. */\ndeclare const ext: {\n${ext.join("\n")}\n};\n${globals.join("\n")}\n`;
}

/** The declarations a button's script on a page of that schema sees, with the workspace's extensions and selects. */
export const scriptTypes = (schema: Schema, extensions: readonly ScriptExtension[], selects: readonly ScriptSelect[]) =>
  LANGUAGE_TYPES + API + thisProps(schema) + selectTypes(selects) + extensionTypes(extensions);
