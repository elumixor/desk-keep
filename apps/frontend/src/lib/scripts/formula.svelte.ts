import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import { computeFormulas, type FormulaPages, type FormulaRun, formulaData, runFormula } from "$model/formula/run";
import type { PropertyValues } from "$model/properties";
import type { PageRecord } from "$model/sync";
import { local } from "../sync/local.svelte";

/**
 * Formulas computed in the browser, from the pages as synced here, so a value shows the moment what it reads
 * changes; the server computes the same (`model/formula/run.ts`) when the page is written, for every other reader.
 * QuickJS is loaded once the app has settled; until then, values are the server's.
 */

const pages: FormulaPages = {
  find: (id) => local.page(id),
  children: (id) => local.childrenOf(id).filter((child) => child.kind === "page"),
};

/** How many pages' results are kept; past it, the oldest go. */
const CACHE_LIMIT = 2000;

class Formulas {
  #module = $state.raw<QuickJSWASMModule | null>(null);
  #loading: Promise<QuickJSWASMModule> | undefined;
  /** A page's results, by what they were computed from, so a page drawn again computes nothing. */
  readonly #cache = new Map<string, { readonly key: string; readonly values: PropertyValues }>();

  load() {
    this.#loading ??= newQuickJSWASMModuleFromVariant(variant).then((module) => (this.#module = module));
    return this.#loading;
  }

  /** The page's values with its formulas as they are now; the stored ones until QuickJS has loaded. */
  values(page: PageRecord): PropertyValues {
    const module = this.#module;
    if (!module || !page.schema.some((p) => p.type === "formula")) return page.properties;
    const key = JSON.stringify(formulaData(page, pages)) + JSON.stringify(page.schema);
    const cached = this.#cache.get(page.id);
    if (cached?.key === key) return cached.values;
    const values = computeFormulas(module, page, pages);
    this.#cache.delete(page.id);
    this.#cache.set(page.id, { key, values });
    if (this.#cache.size > CACHE_LIMIT) this.#cache.delete(this.#cache.keys().next().value ?? "");
    return values;
  }

  /** A view's sort expression on one page, kept until the page or the code changes; `undefined` until QuickJS loads. */
  readonly #keys = new Map<string, { readonly key: string; readonly value: unknown }>();
  sortKey(page: PageRecord, code: string): unknown {
    const module = this.#module;
    if (!module) {
      void this.load();
      return undefined;
    }
    const data = formulaData(page, pages);
    const key = code + JSON.stringify(data);
    const cached = this.#keys.get(page.id);
    if (cached?.key === key) return cached.value;
    const value = runFormula(module, code, data).value;
    this.#keys.delete(page.id);
    this.#keys.set(page.id, { key, value });
    if (this.#keys.size > CACHE_LIMIT) this.#keys.delete(this.#keys.keys().next().value ?? "");
    return value;
  }

  /** One formula's code run on a page, as it is being edited. */
  async run(pageId: string, code: string): Promise<FormulaRun> {
    const page = local.page(pageId);
    if (!page) return { value: null, error: "This page is not loaded" };
    return runFormula(await this.load(), code, formulaData(page, pages));
  }
}

export const formulas = new Formulas();
