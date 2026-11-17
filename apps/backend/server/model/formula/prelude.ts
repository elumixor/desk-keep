import { LANGUAGE_SOURCE } from "../script/language";

/**
 * The JavaScript a formula runs in, inside the sandbox: `self`, the page it is computed on, read only, with the pages
 * its relations point to, its children and its parent (each read one step: their own relations, children and parent
 * empty). Nothing reaches outside: no host, no writes, no
 * questions. `__data` is set before it; a formula is the body of a function, its `return` the value.
 */
const API = `
const __page = (data, related, children = [], parent = null) => {
  const values = {};
  for (const [name, value] of Object.entries(data.props)) values[name.toLowerCase()] = [name, value];
  const prop = (name) => {
    const found = values[String(name).toLowerCase()];
    if (!found) throw new Error(data.title + ' has no property "' + name + '"');
    const [own, value] = found;
    const pages = related?.[own];
    return Object.freeze({
      name: own,
      get value() { return pages ? pages.map((page) => __page(page, null)) : value; },
      set value(_) { throw new Error("A formula only reads: it cannot write " + own); },
      toString: () => own + ": " + String(value ?? ""),
    });
  };
  return Object.freeze({
    id: data.id,
    title: data.title,
    prop,
    get props() { return Object.values(values).map(([name]) => prop(name)); },
    children,
    parent,
    toString: () => data.title,
  });
};
globalThis.self = __page(
  __data.self,
  __data.related,
  __data.children.map((child) => __page(child, null)),
  __data.parent && __page(__data.parent, null),
);
`;

/**
 * A formula's value as the property it would be (\`FormulaValue\`): a number, yes or no, text, a date, or pages (one or
 * a list of them, kept as a relation's ids); any other list as its items' text joined, anything else as its text.
 */
const RESULT = `
const __isPage = (value) => typeof value === "object" && value !== null && typeof value.id === "string" && "props" in value;
const __result = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? { type: "number", value } : null;
  if (typeof value === "boolean") return { type: "checkbox", value };
  if (typeof value === "string") return value ? { type: "text", value } : null;
  if (__isPage(value)) return { type: "relation", value: [value.id] };
  if (Array.isArray(value)) {
    if (value.length && value.every(__isPage)) return { type: "relation", value: value.map((page) => page.id) };
    return value.length ? { type: "text", value: value.map(String).join(", ") } : null;
  }
  if (typeof value === "object" && typeof value.start === "string")
    return { type: "date", value: value.end ? { start: value.start, end: String(value.end) } : { start: value.start } };
  return { type: "text", value: String(value) };
};
`;

const PREFIX = `${LANGUAGE_SOURCE}${API}${RESULT}JSON.stringify(__result((function () {\n"use strict";\n`;

/** What a formula reads: the page, and the pages each of its relations points to, by the relation's name. */
export interface FormulaData {
  readonly self: FormulaPageData;
  readonly related: Readonly<Record<string, readonly FormulaPageData[]>>;
  readonly children: readonly FormulaPageData[];
  readonly parent: FormulaPageData | null;
}

export interface FormulaPageData {
  readonly id: string;
  readonly title: string;
  readonly props: Readonly<Record<string, unknown>>;
}

/** The source a formula runs as: its data, the prelude, then its code as a strict function's body; it ends as JSON. */
export const formulaSource = (code: string, data: FormulaData) =>
  `const __data = ${JSON.stringify(data)};\n${PREFIX}${code}\n})()));`;
