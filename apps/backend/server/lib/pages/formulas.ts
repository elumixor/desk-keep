import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import type { Tx } from "~/db";
import { pages } from "~/db/schema";
import { computeFormulas as compute, formulaData, relatedIds, runFormula } from "~/model/formula/run";
import type { PropertyValues, Schema } from "~/model/properties";
import { readableWith } from "../access";

/**
 * Formulas computed on the server, on the page and the pages its relations point to, loaded once. A formula that
 * throws, loops or runs out of room is empty, as one that returns nothing.
 */

let quickjs: Promise<QuickJSWASMModule> | undefined;

interface Values {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly schema: Schema;
  readonly properties: PropertyValues;
}

/** The page's values with its formulas computed (`model/formula/run.ts`), its related pages loaded first. */
export async function computeFormulas(tx: Tx, page: Values): Promise<PropertyValues> {
  const formulas = page.schema.filter((p) => p.type === "formula" && p.formula?.trim());
  if (!formulas.length) return page.properties;
  // The pages its relations point to, its parent and its children, in one query.
  const ids = [...relatedIds(page), ...(page.parentId ? [page.parentId] : [])];
  const rows = await tx.query.pages.findMany({
    where: and(
      isNull(pages.deletedAt),
      or(...(ids.length ? [inArray(pages.id, ids)] : []), and(eq(pages.parentId, page.id), eq(pages.kind, "page"))),
    ),
    orderBy: asc(pages.sort),
  });
  // Its result is stored on the page for all its readers: the parent and related pages they may not all read stay out.
  const readable = await readableWith(
    tx,
    page.id,
    rows.filter((row) => row.parentId !== page.id).map((row) => row.id),
  );
  const byId = new Map(
    rows.filter((row) => row.parentId === page.id || readable.has(row.id)).map((row) => [row.id, row]),
  );
  const children = rows.filter((row) => row.parentId === page.id && row.kind === "page");
  quickjs ??= newQuickJSWASMModuleFromVariant(variant);
  return compute(await quickjs, page, { find: (id) => byId.get(id), children: () => children });
}

/**
 * A view's sort expression run on each of its pages, by id. On the server it reads the page alone: its relations,
 * parent and children are not loaded, so an expression reading them sorts as empty here (assistants), not in the app.
 */
export async function sortKeys(found: readonly Values[], code: string): Promise<Map<string, unknown>> {
  quickjs ??= newQuickJSWASMModuleFromVariant(variant);
  const module = await quickjs;
  const none = { find: () => undefined, children: () => [] };
  return new Map(found.map((page) => [page.id, runFormula(module, code, formulaData(page, none)).value]));
}
