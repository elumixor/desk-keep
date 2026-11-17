import { parseArgs } from "node:util";
import {
  type BlockObjectResponse,
  Client,
  collectAllDataSourceRows,
  collectPaginatedAPI,
  isFullBlock,
  isFullPage,
  type PageObjectResponse,
} from "@notionhq/client";
import { z } from "zod";
import type { DocNode } from "../server/model/document";
import {
  type NotionBlock,
  notionDoc,
  notionIcon,
  notionKey,
  notionSchema,
  notionValues,
  pageTitle,
  plainOf,
} from "../server/model/notion";
import type { PropertyValues, Schema } from "../server/model/properties";

/**
 * Copies a Notion page tree into Keep: `bun run import:notion --page <notion page id> --parent <keep page id>`.
 * A Notion database becomes a trait (its properties) and a page whose table view shows its children having the
 * trait; its rows become those children. First every page and row is created (so every Notion id has a Keep id), then
 * bodies and values are written, which lets mentions and relations point at pages imported later in the walk.
 */
const env = z
  .object({ NOTION_TOKEN: z.string().min(1), KEEP_URL: z.url(), KEEP_KEY: z.string().startsWith("keep_") })
  .parse(process.env);

const { values: args } = parseArgs({ options: { page: { type: "string" }, parent: { type: "string" } } });
const { page: rootPage, parent: rootParent } = z.object({ page: z.string().min(1), parent: z.uuid() }).parse(args);

class KeepRequestError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    body: string,
  ) {
    super(`${method} ${path} → ${status}: ${body}`);
    this.name = "KeepRequestError";
  }
}

async function keep<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, env.KEEP_URL), {
    method,
    headers: { authorization: `Bearer ${env.KEEP_KEY}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new KeepRequestError(method, path, res.status, await res.text());
  return (await res.json()) as T;
}

interface Created {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly NotionBlock[];
  readonly row?: { readonly page: PageObjectResponse; readonly schema: Schema };
}

const STRUCTURAL = new Set<BlockObjectResponse["type"]>(["child_page", "child_database"]);

class NotionImport {
  readonly #notion = new Client({ auth: env.NOTION_TOKEN });
  readonly #created = new Map<string, Created>();
  #workspaceId: string | null = null;

  get count() {
    return this.#created.size;
  }

  async #blocks(blockId: string): Promise<NotionBlock[]> {
    const list = await collectPaginatedAPI(this.#notion.blocks.children.list, { block_id: blockId });
    return Promise.all(
      list.filter(isFullBlock).map(async (block) => ({
        block,
        children: block.has_children && !STRUCTURAL.has(block.type) ? await this.#blocks(block.id) : [],
      })),
    );
  }

  async #create(
    notionId: string,
    input: { parentId: string; title: string; icon: string | null; traits?: string[] },
    entry: Omit<Created, "id" | "title">,
  ) {
    const { id } = await keep<{ id: string }>("POST", "/api/pages", input);
    this.#created.set(notionKey(notionId), { id, title: input.title, ...entry });
    console.log(`${input.traits ? "row " : "page"}  ${input.title}`);
    return id;
  }

  /** The Keep workspace the import lands in, where its traits are defined. */
  async #workspace(parentId: string) {
    this.#workspaceId ??= (
      await keep<{ page: { workspaceId: string } }>("GET", `/api/pages/${parentId}`)
    ).page.workspaceId;
    return this.#workspaceId;
  }

  /** The page with every page and database under it, then their bodies and values. */
  async run(pageId: string, parentId: string) {
    await this.#page(await this.#retrievePage(pageId), parentId);
    await this.#fill();
  }

  /** A page and, under it, the pages and databases its body holds. */
  async #page(page: PageObjectResponse, parentId: string, row?: Created["row"] & { readonly trait: string }) {
    const blocks = await this.#blocks(page.id);
    const id = await this.#create(
      page.id,
      { parentId, title: pageTitle(page), icon: notionIcon(page.icon), ...(row && { traits: [row.trait] }) },
      { blocks, row },
    );
    await this.#children(blocks, id);
  }

  async #children(blocks: readonly NotionBlock[], parentId: string): Promise<void> {
    for (const { block, children } of blocks) {
      if (block.type === "child_page") await this.#page(await this.#retrievePage(block.id), parentId);
      else if (block.type === "child_database") await this.#database(block.id, parentId);
      else await this.#children(children, parentId);
    }
  }

  async #retrievePage(id: string) {
    const page = await this.#notion.pages.retrieve({ page_id: id });
    if (!isFullPage(page)) throw new NotionAccessError(id);
    return page;
  }

  /** A database (its first data source): a trait of its properties, a page with a table of it, its rows under it. */
  async #database(databaseId: string, parentId: string) {
    const database = await this.#notion.databases.retrieve({ database_id: databaseId });
    if (!("data_sources" in database)) throw new NotionAccessError(databaseId);
    const [first] = database.data_sources;
    if (!first) throw new NotionAccessError(databaseId);
    const source = await this.#notion.dataSources.retrieve({ data_source_id: first.id });
    const schema = notionSchema(source);
    const title = plainOf(database.title) || "Untitled";
    const trait = await keep<{ id: string }>("POST", `/api/workspaces/${await this.#workspace(parentId)}/traits`, {
      name: title,
      icon: notionIcon(database.icon),
      properties: schema,
    });
    const id = await this.#create(databaseId, { parentId, title, icon: notionIcon(database.icon) }, { blocks: [] });
    await keep("POST", `/api/pages/${id}/views`, {
      name: "Table",
      kind: "table",
      scope: "children",
      filter: [{ property: "$trait", op: "is", value: trait.id }],
    });
    const rows = await collectAllDataSourceRows(this.#notion, { data_source_id: first.id });
    for (const row of rows.filter(isFullPage)) await this.#page(row, id, { page: row, schema, trait: trait.id });
  }

  /** Second pass: bodies and row values, now that every imported page has its Keep id. */
  async #fill() {
    for (const { id, blocks, row } of this.#created.values()) {
      const body: DocNode | undefined = blocks.length ? notionDoc(blocks, this.#created) : undefined;
      const properties: PropertyValues | undefined = row && notionValues(row.schema, row.page, this.#created);
      if (body || properties) await keep("PATCH", `/api/pages/${id}`, { body, properties });
    }
  }
}

class NotionAccessError extends Error {
  constructor(readonly notionId: string) {
    super(`Notion returned a partial object for ${notionId}: share it with the integration`);
    this.name = "NotionAccessError";
  }
}

const notionImport = new NotionImport();
await notionImport.run(rootPage, rootParent);
console.log(`imported ${notionImport.count} pages`);
