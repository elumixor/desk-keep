/**
 * How a button's script names what extensions give it: an extension is a namespace (`dev`, under `ext` and, when the
 * name is free, on its own), each of its actions a method (`setup-project` → `setupProject`). The server's prelude and
 * the editor's typings both name them here, so what the editor offers is what runs.
 */

/**
 * What a script does in the app of whoever pressed, not to pages: a message, a tab, a question, a log. The editor
 * draws them apart from the rest.
 */
export const CLIENT_CALLS: ReadonlySet<string> = new Set(["notify", "open", "ask", "log", "console"]);

/** What a script has of its own, which no extension's namespace may shadow. */
const GLOBALS = new Set([
  "page",
  "self",
  "workspace",
  "findPages",
  "Page",
  "Property",
  "select",
  "keys",
  "values",
  ...CLIENT_CALLS,
  "ext",
  "globalThis",
  "undefined",
  "NaN",
  "Infinity",
]);
const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield await".split(
    " ",
  ),
);

/** Text as a camelCase identifier: `Set up dev project` → `setUpDevProject`, `2fa` → `_2fa`. */
export function identifier(text: string) {
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words
    .map((word, i) => (i ? word[0].toUpperCase() + word.slice(1) : word[0].toLowerCase() + word.slice(1)))
    .join("");
  if (!name) return "_";
  return /^\d/.test(name) || RESERVED.has(name) ? `_${name}` : name;
}

export interface Named {
  readonly id: string;
  readonly name: string;
}

export interface Namespace {
  readonly name: string;
  /** Whether it is also a global (`dev`), not only `ext.dev`. */
  readonly global: boolean;
}

/** Each extension's namespace, by extension id; a name taken by an earlier one gets a number. */
export function namespaces(extensions: readonly Named[]): ReadonlyMap<string, Namespace> {
  const taken = new Set<string>();
  return new Map(
    extensions.map(({ id, name }) => {
      const base = identifier(name);
      let free = base;
      for (let n = 2; taken.has(free); n++) free = `${base}${n}`;
      taken.add(free);
      return [id, { name: free, global: !GLOBALS.has(free) }];
    }),
  );
}

/** How `select("…")` names a select: its page and the property's name. */
export const SELECT_REF = /^([0-9a-f-]{36})\/(.+)$/i;
export const selectRef = (pageId: string, property: string) => `${pageId}/${property}`;

/** An action's method name. */
export const methodOf = (actionId: string) => identifier(actionId);
