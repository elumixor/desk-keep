import type { PropertyType } from "../properties";
import { methodOf, namespaces } from "./names";
import type { ScriptExtension } from "./types";

/**
 * What a script can use, as the editor lists it beside the code: pages and how to reach them, what lists add, what
 * reaches whoever pressed, and each extension's actions. Each says what it does, how it is written and an example,
 * and what clicking it inserts.
 */
export interface ScriptTerm {
  readonly group: string;
  readonly name: string;
  readonly doc: string;
  readonly insert: string;
  readonly examples: readonly string[];
  /** A property's type (its icon), or an extension action's lucide icon. */
  readonly propertyType?: PropertyType;
  readonly icon?: string;
  /** Done in the app of whoever pressed, not to pages (`CLIENT_CALLS`). */
  readonly client?: boolean;
}

const PAGES = "Pages";
const LISTS = "Lists";
const IN_THE_APP = "In the app";

const BUILT_IN: readonly ScriptTerm[] = [
  {
    group: PAGES,
    name: "self",
    doc: "The page whose button was pressed.",
    insert: "self",
    examples: ["self.title", 'self.prop("Status").value = "Done"', 'self.prop("Status").value'],
  },
  {
    group: PAGES,
    name: 'page("…")',
    doc: "Another page: type its name inside the quotes to pick it.",
    insert: "page(",
    examples: ['page("…").prop("Status").value'],
  },
  {
    group: PAGES,
    name: "workspace",
    doc: "The workspace: the page every other is under.",
    insert: "workspace",
    examples: ["workspace.children.length"],
  },
  {
    group: PAGES,
    name: "findPages()",
    doc: "The workspace's pages whose title matches, best first.",
    insert: 'findPages("")',
    examples: ['findPages("bug").length', 'findPages("bug").first?.title'],
  },
  {
    group: PAGES,
    name: ".prop()",
    doc: "One of a page's properties, by name: read its value, or assign one to write it (null clears it). .props lists them all.",
    insert: "self.prop(",
    examples: ['self.prop("Due date").value', 'self.prop("Status").value = "Done"', 'self.prop("Done").value = null'],
  },
  {
    group: PAGES,
    name: ".children",
    doc: "The pages right under a page: add one to move it here (or make it, when new), remove one to trash it.",
    insert: "self.children",
    examples: ["self.children.length", 'self.children.add(page("…"))', "self.children.remove(self.children.last)"],
  },
  {
    group: PAGES,
    name: "new Page()",
    doc: "A page to be made, with a title, traits and properties of its own: made when added to some page's children.",
    insert: 'new Page({ title: "" })',
    examples: [
      'self.children.add(new Page({ title: "Notes" }))',
      'self.children.add(new Page({ title: "Fix login", traits: ["Task"], properties: [new Property("Status", "select", "To do")] }))',
    ],
  },
  {
    group: PAGES,
    name: ".copy()",
    doc: "A copy of a page (title, properties, text): made when added to some page's children.",
    insert: "self.copy()",
    examples: ["self.parent?.children.add(self.copy())"],
  },
  {
    group: PAGES,
    name: 'select("…")',
    doc: "A select property's options, to ask for one of them: type its page or name inside the quotes to pick it.",
    insert: "select(",
    examples: ['ask("Move to?", select("…"))'],
  },
  {
    group: LISTS,
    name: ".first / .last",
    doc: "A list's first or last item; undefined when it is empty.",
    insert: ".first",
    examples: ["self.children.first?.title", "self.children.last"],
  },
  {
    group: LISTS,
    name: ".sum",
    doc: "A list's numbers added up.",
    insert: ".sum",
    examples: ['self.children.map((child) => child.prop("Hours").value).sum'],
  },
  {
    group: LISTS,
    name: ".map() / .filter()",
    doc: "A list turned into another, or narrowed to the items that pass.",
    insert: ".map((item) => item)",
    examples: [
      "self.children.map((child) => child.title)",
      'self.children.filter((child) => child.prop("Status").value === "Done")',
    ],
  },
  {
    group: IN_THE_APP,
    name: "notify()",
    doc: "Shows a message to whoever pressed the button.",
    insert: 'notify("")',
    examples: ['notify("Done")', 'notify(self.children.length + " pages")'],
  },
  {
    group: IN_THE_APP,
    name: "ask()",
    doc: "Asks whoever pressed: text, a number, yes or no, a date, or one of some options (or of a select's).",
    insert: 'ask("")',
    examples: [
      'const title = ask("Title of the new page?")',
      'const hours = ask("How many hours?", "number")',
      'const urgent = ask("Urgent?", "checkbox")',
      'const due = ask("Due when?", "date")',
      'const size = ask("Size?", ["S", "M", "L"])',
      'const status = ask("Move to?", select("…"))',
    ],
  },
  {
    group: IN_THE_APP,
    name: "open()",
    doc: "Opens a link in a new tab for whoever pressed the button.",
    insert: 'open("")',
    examples: ['open("https://example.com")'],
  },
  {
    group: IN_THE_APP,
    name: "log()",
    doc: "Writes to the output under the code, when it is run from here, and the browser's console.",
    insert: "log()",
    examples: ["log(self.title)", "log(self.props.map((p) => p.name))"],
  },
].map((term) => (term.group === IN_THE_APP ? { ...term, client: true } : term));

function extensionTerms(extensions: readonly ScriptExtension[]): ScriptTerm[] {
  const names = namespaces(extensions);
  return extensions.flatMap((extension) => {
    const namespace = names.get(extension.id);
    if (!namespace) return [];
    const prefix = `${namespace.global ? "" : "ext."}${namespace.name}`;
    return extension.manifest.actions.map((action) => {
      const call = `${prefix}.${methodOf(action.id)}()`;
      return {
        group: extension.name,
        name: action.label,
        doc: `${action.label}, by ${extension.name}, on this page (or the page given). Its message and link reach whoever pressed.`,
        insert: call,
        examples: [call, `${prefix}.${methodOf(action.id)}(page("…"))`],
        icon: action.icon,
      };
    });
  });
}

/** The terms of a script, with the workspace's extensions. */
export const scriptTerms = (extensions: readonly ScriptExtension[]): ScriptTerm[] => [
  ...BUILT_IN,
  ...extensionTerms(extensions),
];
