import type { ScriptTerm } from "../script/terms";

/** What a formula can use, as its editor lists it beside the code: the page it reads, and what lists and texts add. */

const PAGE = "This page";
const LISTS = "Lists and texts";

export const FORMULA_TERMS: readonly ScriptTerm[] = [
  {
    group: PAGE,
    name: "return",
    doc: "What the formula is: the value it returns. Without one, it is empty.",
    insert: "return ",
    examples: ['return self.prop("Price").value * self.prop("Qty").value', 'return self.prop("Done").value ? "✓" : ""'],
  },
  {
    group: PAGE,
    name: "self",
    doc: "The page the formula is computed on.",
    insert: "self",
    examples: ["return self.title.uppercase"],
  },
  {
    group: PAGE,
    name: ".prop()",
    doc: "One of the page's properties, by name: its value, read only (a relation's is its pages). .props lists them all.",
    insert: "self.prop(",
    examples: [
      'return self.prop("Due date").value',
      'return self.prop("Tasks").value.map((task) => task.prop("Hours").value).sum',
    ],
  },
  {
    group: LISTS,
    name: ".first / .last",
    doc: "A list's first or last item; null when it is empty.",
    insert: ".first",
    examples: ['return self.prop("Tasks").value.first?.title ?? null'],
  },
  {
    group: LISTS,
    name: ".sum",
    doc: "A list's numbers added up.",
    insert: ".sum",
    examples: ['return self.prop("Tasks").value.map((task) => task.prop("Hours").value).sum'],
  },
  {
    group: LISTS,
    name: ".map() / .filter()",
    doc: "A list turned into another, or narrowed to the items that pass.",
    insert: ".map((item) => item)",
    examples: ['return self.prop("Tasks").value.filter((task) => task.prop("Status").value === "Done").length'],
  },
  {
    group: LISTS,
    name: ".capitalize / .uppercase",
    doc: "A text with its first letter capitalized, or all of it; also .lowercase, .titlecase, .trimmed, .words.",
    insert: ".capitalize",
    examples: ["return self.title.capitalize", "return self.title.words.length"],
  },
];
