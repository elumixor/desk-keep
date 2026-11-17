import { type QuickJSWASMModule, shouldInterruptAfterDeadline } from "quickjs-emscripten-core";
import type { FormulaValue, PropertyValues, Schema } from "../properties";
import { readValue } from "../script/snapshot";
import { type FormulaData, type FormulaPageData, formulaSource } from "./prelude";

/**
 * Runs a formula in QuickJS's synchronous build (a formula reads only what it is given), on the server when a page is
 * written and in the browser while it is edited. The module is the caller's: Node's build or the browser's.
 */

const MEMORY_BYTES = 8 * 1024 * 1024;
const DEADLINE_MS = 1000;

interface Values {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly schema: Schema;
  readonly properties: PropertyValues;
}

/** A page's values as a formula reads them; a related page's relations empty, so it reads one step and no further. */
const pageData = (page: Values, related: boolean): FormulaPageData => ({
  id: page.id,
  title: page.title,
  props: Object.fromEntries(
    page.schema.map((p) => [p.name, p.type === "relation" && related ? [] : readValue(p, page.properties[p.name])]),
  ),
});

/** Where a formula's pages come from: any page by id, and the pages under one. Missing ones are left out. */
export interface FormulaPages {
  find(id: string): Values | undefined;
  children(id: string): readonly Values[];
}

/** What a formula on `page` reads: the page, the pages its relations point to, its children and its parent. */
export function formulaData(page: Values, { find, children }: FormulaPages): FormulaData {
  const parent = page.parentId ? find(page.parentId) : undefined;
  const related = Object.fromEntries(
    page.schema
      .filter((p) => p.type === "relation")
      .map((p) => [
        p.name,
        ((page.properties[p.name] as string[] | undefined) ?? []).flatMap((id) => {
          const found = find(id);
          return found ? [pageData(found, true)] : [];
        }),
      ]),
  );
  return {
    self: pageData(page, false),
    related,
    children: children(page.id).map((child) => pageData(child, true)),
    parent: parent ? pageData(parent, true) : null,
  };
}

/** The ids a formula on `page` reads through its relations, to be loaded before `formulaData`. */
export const relatedIds = (page: Values) =>
  page.schema
    .filter((p) => p.type === "relation")
    .flatMap((p) => (page.properties[p.name] as string[] | undefined) ?? []);

export interface FormulaRun {
  readonly value: FormulaValue | null;
  /** What it threw, or why it stopped; the value is then empty. */
  readonly error?: string;
}

const message = (thrown: unknown) => {
  if (typeof thrown === "object" && thrown !== null && "message" in thrown) {
    const { name, message } = thrown as { name?: string; message?: string };
    return `${name ?? "Error"}: ${message ?? ""}`;
  }
  return String(thrown);
};

/** Runs one formula on its data. */
export function runFormula(module: QuickJSWASMModule, code: string, data: FormulaData): FormulaRun {
  const context = module.newContext();
  context.runtime.setMemoryLimit(MEMORY_BYTES);
  context.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + DEADLINE_MS));
  try {
    const result = context.evalCode(formulaSource(code, data), "formula.js");
    if (result.error) {
      const error = message(context.dump(result.error));
      result.error.dispose();
      return { value: null, error };
    }
    const json = context.getString(result.value);
    result.value.dispose();
    return { value: JSON.parse(json) as FormulaValue | null };
  } finally {
    context.dispose();
  }
}

/**
 * The page's values with its formulas computed, in the order the schema has them, so a later formula reads an
 * earlier one's result: on the server when the page is written, in the browser as soon as it changes there.
 */
export function computeFormulas(module: QuickJSWASMModule, page: Values, pages: FormulaPages): PropertyValues {
  const computed: Record<string, PropertyValues[string]> = { ...page.properties };
  for (const formula of page.schema.filter((p) => p.type === "formula" && p.formula?.trim())) {
    const { value } = runFormula(module, formula.formula ?? "", formulaData({ ...page, properties: computed }, pages));
    if (value === null) delete computed[formula.name];
    else computed[formula.name] = value;
  }
  return computed;
}
