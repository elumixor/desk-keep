import { type DocNode, MENTION } from "./document";
import { inlineMarkdown } from "./markdown";
import type { Assignee, PropertyValues, Schema } from "./properties";
import { refsIn } from "./refs";
import { personIdOf } from "./urn";

/**
 * Who a page or a comment names: the People persons mentioned (`@` in the title or the body, `[Name](<person address>)`
 * in a comment) or set on a person property. Pure, so the writes that notify (`lib/notify`) diff a page before and after.
 */
export type MentionWhere = "body" | "title" | "property" | "comment";

export interface MentionSite {
  readonly where: MentionWhere;
  /** The person property's name, for `property`. */
  readonly property?: string;
  /** What names them, `[Label](urn)` tokens kept: the paragraph, the title, the property's name, the comment; ≤ 200 chars. */
  readonly snippet: string;
}

/** People person id → where it is named (one site per person). */
export type Mentions = ReadonlyMap<string, MentionSite>;

const SNIPPET_MAX = 200;

const clip = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat;
};

/** The people a run of inline nodes mentions, each with the run as its snippet. */
function* mentionedIn(nodes: readonly DocNode[], line: DocNode): Generator<[string, string]> {
  for (const node of nodes) {
    if (node.type === MENTION && typeof node.attrs?.id === "string") {
      const id = personIdOf(node.attrs.id);
      if (id) yield [id, clip(inlineMarkdown(line))];
    }
    if (node.content) yield* mentionedIn(node.content, node);
  }
}

/** The textblocks of a document (the lines a mention sits on), in order. */
function* textblocks(node: DocNode): Generator<DocNode> {
  const inlineOnly = !!node.content?.length && node.content.every((c) => c.type === "text" || !c.content);
  if (node.type !== "doc" && inlineOnly) {
    yield node;
    return;
  }
  for (const child of node.content ?? []) yield* textblocks(child);
}

/**
 * The people a page names: on person properties (by the property's name), in the title's line (`body.attrs.title`)
 * and in the body. One site each; a property wins over the title, the title over the body.
 */
export function pageMentions(page: {
  readonly body: DocNode | null;
  readonly schema: Schema;
  readonly properties: PropertyValues;
}): Mentions {
  const out = new Map<string, MentionSite>();
  const body = page.body;
  if (body) {
    for (const line of textblocks(body))
      for (const [id, snippet] of mentionedIn(line.content ?? [], line))
        if (!out.has(id)) out.set(id, { where: "body", snippet });
    const title = Array.isArray(body.attrs?.title) ? (body.attrs.title as DocNode[]) : [];
    const titleLine: DocNode = { type: "title", content: title };
    for (const [id, snippet] of mentionedIn(title, titleLine)) out.set(id, { where: "title", snippet });
  }
  for (const definition of page.schema) {
    if (definition.type !== "person") continue;
    const value = page.properties[definition.name] as readonly Assignee[] | null | undefined;
    for (const assignee of value ?? [])
      if (assignee) out.set(assignee.id, { where: "property", property: definition.name, snippet: definition.name });
  }
  return out;
}

/** The people a comment's text mentions (`[Label](<person address>)`), the comment as the snippet. */
export function commentMentions(body: string): Mentions {
  const out = new Map<string, MentionSite>();
  for (const ref of refsIn(body)) {
    const id = personIdOf(ref.urn);
    if (id && !out.has(id)) out.set(id, { where: "comment", snippet: clip(body) });
  }
  return out;
}

/** The people in `after` not in `before` (newly mentioned or assigned), with their site in `after`; null `before` = created. */
export function addedMentions(before: Mentions | null, after: Mentions): Mentions {
  return new Map([...after].filter(([id]) => !before?.has(id)));
}
