import type {
  BlockObjectResponse,
  DataSourceObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client";
import { type DocNode, MENTION } from "./document";
import type { PropertyDefinition, PropertyValue, PropertyValues, Schema } from "./properties";
import { pageUrn } from "./urn";

/**
 * Notion's API objects as Keep's: blocks become editor nodes, a data source's properties a trait's, a row's values
 * property values by name. Pure: the importer fetches, this only translates.
 */

/** A block with the children Notion lists separately, fetched and attached. */
export interface NotionBlock {
  readonly block: BlockObjectResponse;
  readonly children: readonly NotionBlock[];
}

/** Notion ids already imported, to the Keep page each became. Keys are Notion ids without dashes. */
type ImportedPages = ReadonlyMap<string, { readonly id: string; readonly title: string }>;

export const notionKey = (id: string) => id.replaceAll("-", "");

type Mark = NonNullable<DocNode["marks"]>[number];

const MARKS = [
  ["bold", "bold"],
  ["italic", "italic"],
  ["strikethrough", "strike"],
  ["code", "code"],
] as const;

function marksOf(item: RichTextItemResponse): Mark[] {
  const marks: Mark[] = MARKS.filter(([notion]) => item.annotations[notion]).map(([, type]) => ({ type }));
  return item.href ? [...marks, { type: "link", attrs: { href: item.href } }] : marks;
}

function textNodes(value: string, marks: readonly Mark[]): DocNode[] {
  return value
    .split("\n")
    .flatMap((line, i): DocNode[] => [
      ...(i ? [{ type: "hardBreak" }] : []),
      ...(line ? [{ type: "text", text: line, ...(marks.length ? { marks } : {}) }] : []),
    ]);
}

const mention = (page: { id: string; title: string }): DocNode => ({
  type: MENTION,
  attrs: { id: pageUrn(page.id), label: page.title },
});

function mentionedPage(item: RichTextItemResponse): string | null {
  if (item.type !== "mention") return null;
  const { mention } = item;
  return mention.type === "page" ? mention.page.id : mention.type === "database" ? mention.database.id : null;
}

function inlineNodes(items: readonly RichTextItemResponse[], pages: ImportedPages): DocNode[] {
  return items.flatMap((item) => {
    const target = mentionedPage(item);
    const imported = target ? pages.get(notionKey(target)) : undefined;
    if (imported) return [mention({ id: imported.id, title: item.plain_text || imported.title })];
    return textNodes(item.plain_text, target ? [] : marksOf(item));
  });
}

export const plainOf = (items: readonly RichTextItemResponse[]) => items.map((i) => i.plain_text).join("");

const paragraph = (content: DocNode[]): DocNode => ({ type: "paragraph", content });

const LISTS = {
  bulleted_list_item: "bulletList",
  numbered_list_item: "orderedList",
  to_do: "taskList",
} as const;
type ListBlock = keyof typeof LISTS;
const isList = (type: string): type is ListBlock => type in LISTS;

const MAX_HEADING = 3;

function pageLink(notionId: string, fallback: string, pages: ImportedPages): DocNode {
  const imported = pages.get(notionKey(notionId));
  return paragraph(imported ? [mention(imported)] : textNodes(fallback, []));
}

function richTextOf(block: BlockObjectResponse): RichTextItemResponse[] {
  const payload = (block as unknown as Record<string, { rich_text?: RichTextItemResponse[] }>)[block.type];
  return payload?.rich_text ?? [];
}

function table({ children }: NotionBlock, hasHeader: boolean, pages: ImportedPages): DocNode {
  return {
    type: "table",
    content: children.flatMap(({ block }, row) =>
      block.type === "table_row"
        ? [
            {
              type: "tableRow",
              content: block.table_row.cells.map((cell) => ({
                type: hasHeader && row === 0 ? "tableHeader" : "tableCell",
                content: [paragraph(inlineNodes(cell, pages))],
              })),
            },
          ]
        : [],
    ),
  };
}

function urlOf(media: { type: "external"; external: { url: string } } | { type: "file"; file: { url: string } }) {
  return media.type === "external" ? media.external.url : media.file.url;
}

/** One block as the editor nodes it becomes; list items are grouped by `blockNodes`. */
function blockNode(node: NotionBlock, pages: ImportedPages): DocNode[] {
  const { block, children } = node;
  const inner = () => blockNodes(children, pages);
  const text = () => inlineNodes(richTextOf(block), pages);
  switch (block.type) {
    case "paragraph":
      return [paragraph(text()), ...inner()];
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "heading_4": {
      const level = Math.min(Number(block.type.slice(-1)), MAX_HEADING);
      return [{ type: "heading", attrs: { level }, content: text() }, ...inner()];
    }
    case "quote":
    case "callout":
      return [{ type: "blockquote", content: [paragraph(text()), ...inner()] }];
    case "toggle":
      return [paragraph(text()), ...inner()];
    case "code":
      return [
        {
          type: "codeBlock",
          attrs: { language: block.code.language },
          content: textNodes(plainOf(block.code.rich_text), []),
        },
      ];
    case "divider":
      return [{ type: "horizontalRule" }];
    case "image":
      return [{ type: "image", attrs: { src: urlOf(block.image), alt: plainOf(block.image.caption) || null } }];
    case "table":
      return [table(node, block.table.has_column_header, pages)];
    case "child_page":
      return [pageLink(block.id, block.child_page.title, pages)];
    case "child_database":
      return [pageLink(block.id, block.child_database.title, pages)];
    case "link_to_page": {
      const link = block.link_to_page;
      if (link.type === "comment_id") return [];
      return [pageLink(link.type === "page_id" ? link.page_id : link.database_id, "", pages)];
    }
    case "bookmark":
    case "embed":
    case "link_preview": {
      const url =
        block.type === "bookmark"
          ? block.bookmark.url
          : block.type === "embed"
            ? block.embed.url
            : block.link_preview.url;
      return [paragraph([{ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }])];
    }
    case "equation":
      return [{ type: "codeBlock", attrs: { language: "latex" }, content: textNodes(block.equation.expression, []) }];
    case "column_list":
    case "column":
    case "synced_block":
    case "tab":
      return inner();
    default:
      return [];
  }
}

function listItem(node: NotionBlock, pages: ImportedPages): DocNode {
  const { block } = node;
  const content = [paragraph(inlineNodes(richTextOf(block), pages)), ...blockNodes(node.children, pages)];
  return block.type === "to_do"
    ? { type: "taskItem", attrs: { checked: block.to_do.checked }, content }
    : { type: "listItem", content };
}

/** Sibling blocks as editor nodes: consecutive list items of one kind become one list, nested lists stay nested. */
function blockNodes(nodes: readonly NotionBlock[], pages: ImportedPages): DocNode[] {
  const out: DocNode[] = [];
  let index = 0;
  while (index < nodes.length) {
    const type = nodes[index].block.type;
    if (!isList(type)) {
      out.push(...blockNode(nodes[index++], pages));
      continue;
    }
    const items: DocNode[] = [];
    while (index < nodes.length && nodes[index].block.type === type) items.push(listItem(nodes[index++], pages));
    out.push({ type: LISTS[type], content: items });
  }
  return out;
}

export const notionDoc = (nodes: readonly NotionBlock[], pages: ImportedPages): DocNode => ({
  type: "doc",
  content: blockNodes(nodes, pages),
});

type Icon = PageObjectResponse["icon"];

/** An emoji icon carries over; Notion's own icon set, uploads and links are left behind. */
export const notionIcon = (icon: Icon) => (icon?.type === "emoji" ? icon.emoji : null);

export function pageTitle(page: PageObjectResponse): string {
  const title = Object.values(page.properties).find((p) => p.type === "title");
  return title?.type === "title" ? plainOf(title.title) : "";
}

type NotionProperty = DataSourceObjectResponse["properties"][string];

function definition(property: NotionProperty): PropertyDefinition | null {
  // A Keep property name never starts with `$` (a view's own keys do).
  const base = { name: property.name.replace(/^\$+/, "").trim() || "Property" };
  switch (property.type) {
    case "title":
      return null;
    case "number":
    case "date":
    case "relation":
    case "checkbox":
    case "url":
      return { ...base, type: property.type };
    case "people":
      return { ...base, type: "person" };
    case "select":
    case "multi_select":
    case "status": {
      const options = (
        property.type === "select"
          ? property.select
          : property.type === "status"
            ? property.status
            : property.multi_select
      ).options;
      const type = property.type === "multi_select" ? "multi_select" : "select";
      return { ...base, type, options: options.map(({ id, name, color }) => ({ id, name, color })) };
    }
    case "formula":
      return { ...base, type: "formula", formula: "" };
    default:
      return { ...base, type: "text" };
  }
}

/** A data source's properties as Keep's, in Notion's order. The title is the row's own title, not a property. */
export function notionSchema(source: Pick<DataSourceObjectResponse, "properties">): Schema {
  return Object.values(source.properties).flatMap((p) => definition(p) ?? []);
}

type NotionValue = PageObjectResponse["properties"][string];

function isUrl(value: string) {
  return URL.canParse(value);
}

function textValue(value: NotionValue): string | null {
  switch (value.type) {
    case "rich_text":
      return plainOf(value.rich_text);
    case "email":
      return value.email;
    case "phone_number":
      return value.phone_number;
    case "created_time":
      return value.created_time;
    case "last_edited_time":
      return value.last_edited_time;
    case "unique_id":
      return `${value.unique_id.prefix ? `${value.unique_id.prefix}-` : ""}${value.unique_id.number ?? ""}`;
    case "files":
      return value.files.map((f) => f.name).join(", ");
    default:
      return null;
  }
}

function keepValue(type: PropertyDefinition["type"], value: NotionValue, pages: ImportedPages): PropertyValue | null {
  switch (type) {
    case "number":
      return value.type === "number" ? value.number : null;
    case "checkbox":
      return value.type === "checkbox" ? value.checkbox : null;
    case "url":
      return value.type === "url" && value.url && isUrl(value.url) ? value.url : null;
    case "date":
      return value.type === "date" && value.date
        ? { start: value.date.start, ...(value.date.end ? { end: value.date.end } : {}) }
        : null;
    case "select":
      return value.type === "select"
        ? (value.select?.id ?? null)
        : value.type === "status"
          ? (value.status?.id ?? null)
          : null;
    case "multi_select":
      return value.type === "multi_select" ? value.multi_select.map((o) => o.id) : null;
    case "relation":
      return value.type === "relation" ? value.relation.flatMap((r) => pages.get(notionKey(r.id))?.id ?? []) : null;
    case "text":
      return textValue(value) || null;
    case "person":
    case "formula":
    case "extension":
    case "button":
      return null;
  }
}

/**
 * A row's values for the properties `notionSchema` made, by name (Notion keys a row's values by property name too):
 * people are left empty, formulas are Keep's to compute.
 */
export function notionValues(
  schema: Schema,
  page: Pick<PageObjectResponse, "properties">,
  pages: ImportedPages,
): PropertyValues {
  const byName = new Map(
    Object.entries(page.properties).map(([name, v]) => [name.replace(/^\$+/, "").trim() || "Property", v]),
  );
  return Object.fromEntries(
    schema.flatMap((property) => {
      const value = byName.get(property.name);
      const converted = value ? keepValue(property.type, value, pages) : null;
      return converted === null ? [] : [[property.name, converted]];
    }),
  );
}
