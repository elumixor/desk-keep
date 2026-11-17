import { z } from "zod";
import { DATE_NODE, dateNodeText } from "./dates";
import { EMOJI_NODE, emojiNodeText } from "./icons";
import { isUrn } from "./urn";

/** A page body: the editor's (ProseMirror) JSON document. */
export interface DocNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly DocNode[];
  readonly text?: string;
  readonly marks?: readonly { readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }[];
}

export const docSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(docSchema).optional(),
    text: z.string().optional(),
    marks: z.array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() })).optional(),
  }),
);

export const emptyDoc = (): DocNode => ({ type: "doc", content: [] });

/** Node types that point somewhere: an inline `@` mention and a block that embeds another page. */
export const MENTION = "mention";
const PAGE_EMBED = "pageEmbed";

type LinkKind = "mention" | "embed";

interface DocLink {
  readonly urn: string;
  readonly kind: LinkKind;
}

function* walk(node: DocNode): Generator<DocNode> {
  yield node;
  for (const child of node.content ?? []) yield* walk(child);
}

/** Every URN a document mentions or embeds (its title's line, kept in `attrs.title`, too), once per URN and kind. */
export function extractLinks(doc: DocNode): DocLink[] {
  const seen = new Map<string, DocLink>();
  const title = Array.isArray(doc.attrs?.title) ? (doc.attrs.title as DocNode[]) : [];
  for (const node of [...walk(doc), ...title]) {
    const kind: LinkKind | null = node.type === MENTION ? "mention" : node.type === PAGE_EMBED ? "embed" : null;
    const urn = node.attrs?.id ?? node.attrs?.urn;
    if (!kind || typeof urn !== "string" || !isUrn(urn)) continue;
    seen.set(`${kind}:${urn}`, { urn, kind });
  }
  return [...seen.values()];
}

const BLOCKS = new Set([
  "paragraph",
  "detailsSummary",
  "heading",
  "listItem",
  "taskItem",
  "codeBlock",
  "blockquote",
  "tableCell",
  "tableHeader",
]);

/** The document as plain text, for search: block boundaries become newlines, mentions their label, emoji their text. */
export function plainText(doc: DocNode): string {
  const parts: string[] = [];
  const visit = (node: DocNode) => {
    if (node.text) parts.push(node.text);
    if (node.type === MENTION && typeof node.attrs?.label === "string") parts.push(node.attrs.label);
    if (node.type === EMOJI_NODE) parts.push(emojiNodeText(node.attrs));
    if (node.type === DATE_NODE) parts.push(dateNodeText(node.attrs));
    for (const child of node.content ?? []) visit(child);
    if (BLOCKS.has(node.type)) parts.push("\n");
  };
  visit(doc);
  return parts.join("").replace(/\n+/g, "\n").trim();
}

/** The text of the document's headings, one per line: search ranks a match there above the rest of the body. */
export function headingText(doc: DocNode): string {
  return [...walk(doc)]
    .filter((node) => node.type === "heading")
    .map((node) => plainText(node))
    .filter(Boolean)
    .join("\n");
}
