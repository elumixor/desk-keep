import { coerceValues } from "$model/coerce";
import type { DocNode } from "$model/document";
import {
  findProperty,
  mergeSchema,
  type PropertyDefinition,
  renameSchema,
  renameValues,
  type Schema,
} from "$model/properties";
import type { PageRecord } from "$model/sync";
import { api, KeepApiError } from "../api";
import { pageRecords, synced } from "../sync/client.svelte";
import { local } from "../sync/local.svelte";
import { access } from "./access.svelte";

export type PageData = NonNullable<ReturnType<typeof local.pageData>>;
export type Page = PageData["page"];

interface PagePatch {
  readonly title?: string;
  readonly icon?: string | null;
  readonly description?: string;
  readonly body?: DocNode;
  /** The page's properties. */
  readonly schema?: Schema;
  /** Properties renamed, old name to new; their values move with them. */
  readonly renames?: Record<string, string>;
}

/** From this status on a refusal is the server failing, not an answer about the page. */
const SERVER_FAULT = 500;

/** No page by that id among the records on the device, once they have been checked with the server. */
export class PageMissingError extends Error {
  constructor(id: string) {
    super(`No page ${id}`);
    this.name = "PageMissingError";
  }
}

/** What is known of each page in the trash, so bringing it back is drawn at once (`restorePage`). */
export const trashedRecords = new Map<string, PageRecord>();

/** A page in the trash: not among the synced records, read from the server to be looked at or restored. */
interface TrashedPage {
  readonly data: PageData;
  readonly since: string;
}

type Answer = { readonly found: ServerPage | null } | { readonly error: unknown };
type ServerPage = Awaited<ReturnType<ReturnType<typeof api.pages>["$get"]>>;

/** The server's page, `null` when it refuses it; settled either way, so it can be awaited later. */
const ask = (id: string): Promise<Answer> =>
  api
    .pages(id)
    .$get()
    .then(
      (found) => ({ found }),
      (error: unknown) => (error instanceof KeepApiError && error.status < SERVER_FAULT ? { found: null } : { error }),
    );

/**
 * Pages as the screens read and write them. Reads come from the records on the device (`lib/sync`); a write is drawn
 * at once and queued, so typing, renaming, picking an icon or a value never waits for the server.
 */
class Pages {
  get(id: string): PageData | undefined {
    return local.pageData(id, access.can(id, "write"));
  }

  /**
   * Resolves with `null` once the page is on the device, or with the page as the server keeps it when it is in the
   * trash; rejects with `PageMissingError` only when the server answered and does not have it either. A server that
   * could not be asked is not an answer: that rejects with what went wrong.
   */
  async load(id: string): Promise<TrashedPage | null> {
    if (local.page(id)) return null;
    // Asked alongside the sync rather than after it: a page in the trash never comes with the sync.
    const asked = ask(id);
    await synced.ensure();
    if (local.page(id)) return null;
    const answer = await asked;
    if ("error" in answer) throw answer.error;
    const { found } = answer;
    if (found?.page.deletedAt) {
      const { view: _view, traits, ...page } = found.page;
      trashedRecords.set(id, { ...page, traits: traits.map((t) => t.id) } as unknown as PageRecord);
      return { data: found as unknown as PageData, since: found.page.deletedAt };
    }
    // Made since the last sync: the next one brings it.
    if (found) await synced.sync();
    if (local.page(id)) return null;
    if (synced.error) throw new Error(synced.error);
    throw new PageMissingError(id);
  }

  edit(id: string, patch: PagePatch) {
    const page = local.page(id);
    if (!page) return;
    const { renames, schema, ...fields } = patch;
    const next: Partial<PageRecord> = { ...fields };
    if (renames && Object.keys(renames).length) next.properties = renameValues(page.properties, renames);
    if (schema) {
      // A property whose type changed shows its value read as the new type at once, as the server keeps it.
      const carried = coerceValues(
        renameSchema(page.schema, renames ?? {}),
        schema,
        next.properties ?? page.properties,
      );
      next.schema = [...carried.schema];
      // A property removed takes its value with it, on the device as on the server.
      const names = new Set(schema.map((p) => p.name));
      next.properties = Object.fromEntries(
        Object.entries(carried.values).filter(([key]) => names.has(key)),
      ) as PageRecord["properties"];
    }
    pageRecords.update(id, next);
  }

  /** Text typed in place (title, body, description): synced, but no undo step, as the field keeps its own undo. */
  type(id: string, patch: PagePatch) {
    synced.untracked(() => this.edit(id, patch));
  }

  /** Sets one value of a page; `define` is the property the page is given when it has no such one yet. */
  setProperty(id: string, name: string, value: unknown, define?: PropertyDefinition) {
    const page = local.page(id);
    if (!page) return;
    const properties: Record<string, unknown> = { ...page.properties, [name]: value };
    if (value === null || value === undefined) delete properties[name];
    const missing = define && !findProperty(page.schema, define.name);
    pageRecords.update(id, {
      properties: properties as PageRecord["properties"],
      ...(missing && { schema: [...mergeSchema(page.schema, [define])] }),
    });
  }
}

export const pages = new Pages();
