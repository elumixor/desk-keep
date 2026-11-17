import { Lexer, type Token, type Tokens } from "marked";
import { DATE_NODE, dateNodeText } from "./dates";
import { type DocNode, MENTION } from "./document";
import { EMOJI_NODE, emojiNodeText } from "./icons";
import { formatRef, parseRefs } from "./refs";
import { urlOf, urnOfUrl } from "./urn";

/**
 * Markdown both ways, for assistants. Writing takes GitHub-flavored Markdown (parsed by marked): headings, nested
 * lists, checklists, quotes, tables, code fences (a ```mermaid fence is a diagram), dividers, images, marks and links.
 * Mentions travel as `[Label](address)` both ways (`model/refs.ts`): a page as `[Title](https://keep.example.com/p/<id>)`,
 * a person as `[Name](https://people.example.com/p/<id>)`, so a body read and written back keeps them. A line break in a paragraph is kept.
 */
const text = (value: string): DocNode[] => (value ? [{ type: "text", text: value }] : []);

/** A line's text with its `[Label](urn)` references as mention nodes. */
export const inlineNodes = (value: string): DocNode[] =>
  parseRefs(value).flatMap((segment) =>
    segment.ref
      ? [{ type: MENTION, attrs: { id: segment.ref.urn, label: segment.ref.label, icon: null } }]
      : text(segment.text),
  );

/** A view or a page placed in a body travels as `[view <id>]` or `[embed <address>]`, a paragraph of its own. */
const VIEW = /^\[view ([0-9a-f-]{36})\]$/;
const EMBED = /^\[embed ([^\s\]]+)\]$/;

type Mark = NonNullable<DocNode["marks"]>[number];

function inlines(tokens: readonly Token[] = [], marks: readonly Mark[] = []): DocNode[] {
  const leaf = (value: string, added: readonly Mark[] = marks): DocNode[] =>
    value ? [{ type: "text", text: value, ...(added.length ? { marks: added } : {}) }] : [];
  return tokens.flatMap((token): DocNode[] => {
    const within = (mark: Mark) => inlines((token as Tokens.Generic).tokens, [...marks, mark]);
    switch (token.type) {
      case "strong":
        return within({ type: "bold" });
      case "em":
        return within({ type: "italic" });
      case "del":
        return within({ type: "strike" });
      case "codespan":
        return leaf(token.text, [...marks, { type: "code" }]);
      case "link": {
        const ref = parseRefs(token.raw)[0]?.ref;
        if (ref) return [{ type: MENTION, attrs: { id: ref.urn, label: ref.label, icon: null } }];
        return within({ type: "link", attrs: { href: token.href } });
      }
      case "image":
        return [{ type: "image", attrs: { src: token.href, alt: token.text || null, title: token.title ?? null } }];
      case "br":
        return [{ type: "hardBreak" }];
      case "html":
        return leaf(token.raw);
      default: {
        const { tokens: nested, text: value } = token as Tokens.Generic;
        return nested?.length ? inlines(nested, marks) : leaf(value ?? token.raw);
      }
    }
  });
}

/** A paragraph's content. An image is a block in the editor, so it splits the paragraph around it. */
function paragraphs(tokens: readonly Token[] | undefined): DocNode[] {
  const out: DocNode[] = [];
  let run: DocNode[] = [];
  const flush = () => {
    if (run.length) out.push({ type: "paragraph", content: run });
    run = [];
  };
  for (const node of inlines(tokens)) {
    if (node.type === "image") {
      flush();
      out.push(node);
    } else run.push(node);
  }
  flush();
  return out;
}

const withoutImages = (tokens: readonly Token[] | undefined) => inlines(tokens).filter((node) => node.type !== "image");

function listItem(item: Tokens.ListItem, task: boolean): DocNode {
  const content = blocks(item.tokens);
  // The editor's items open with a paragraph.
  if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph", content: [] });
  return task
    ? { type: "taskItem", attrs: { checked: Boolean(item.checked) }, content }
    : { type: "listItem", content };
}

function list(token: Tokens.List): DocNode {
  if (token.items.some((item) => item.task))
    return { type: "taskList", content: token.items.map((item) => listItem(item, true)) };
  const content = token.items.map((item) => listItem(item, false));
  if (!token.ordered) return { type: "bulletList", content };
  const start = Number(token.start);
  return { type: "orderedList", ...(start > 1 ? { attrs: { start } } : {}), content };
}

function table(token: Tokens.Table): DocNode {
  const row = (cells: readonly Tokens.TableCell[], type: string): DocNode => ({
    type: "tableRow",
    content: cells.map((cell) => {
      const content = paragraphs(cell.tokens);
      return { type, content: content.length ? content : [{ type: "paragraph", content: [] }] };
    }),
  });
  return {
    type: "table",
    content: [row(token.header, "tableHeader"), ...token.rows.map((cells) => row(cells, "tableCell"))],
  };
}

const LEX = { gfm: true, breaks: true } as const;
const lex = (source: string) => Lexer.lex(source, LEX);

/**
 * A toggle travels as HTML's `<details>`: `<summary>Title</summary>`, then its body as Markdown, then `</details>`.
 * Takes the source from the opening tag on and returns the toggle and the source after its closing tag.
 */
function details(source: string): [DocNode, string] {
  const tag = /<\/?details\b[^>]*>/gi;
  const open = tag.exec(source);
  const start = open ? open.index + open[0].length : 0;
  let depth = 1;
  let end = source.length;
  let after = source.length;
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    depth += match[0][1] === "/" ? -1 : 1;
    if (depth) continue;
    end = match.index;
    after = match.index + match[0].length;
    break;
  }
  let inner = source.slice(start, end);
  const summary = inner.match(/^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
  if (summary) inner = inner.slice(summary[0].length);
  const title = (summary?.[1] ?? "").replace(/\s*\n\s*/g, " ").trim();
  const content = blocks(lex(inner));
  return [
    {
      type: "details",
      content: [
        { type: "detailsSummary", content: withoutImages(Lexer.lexInline(title, LEX)) },
        { type: "detailsContent", content: content.length ? content : [{ type: "paragraph", content: [] }] },
      ],
    },
    source.slice(after),
  ];
}

function blocks(tokens: readonly Token[]): DocNode[] {
  const at = tokens.findIndex((token) => token.type === "html" && /^\s*<details\b/i.test(token.raw));
  if (at >= 0) {
    const [toggle, rest] = details(
      tokens
        .slice(at)
        .map((token) => token.raw)
        .join(""),
    );
    return [...blocks(tokens.slice(0, at)), toggle, ...blocks(lex(rest))];
  }
  return tokens.flatMap((token): DocNode[] => {
    switch (token.type) {
      case "heading":
        return [{ type: "heading", attrs: { level: token.depth }, content: withoutImages(token.tokens) }];
      case "code":
        return [{ type: "codeBlock", attrs: { language: token.lang || null }, content: text(token.text) }];
      case "list":
        return [list(token as Tokens.List)];
      case "table":
        return [table(token as Tokens.Table)];
      case "blockquote":
        return [{ type: "blockquote", content: blocks(token.tokens ?? []) }];
      case "hr":
        return [{ type: "horizontalRule" }];
      case "html":
        return [{ type: "paragraph", content: text(token.raw.trim()) }];
      case "paragraph": {
        const raw = token.raw.trim();
        const view = raw.match(VIEW);
        if (view) return [{ type: "viewBlock", attrs: { view: view[1] } }];
        const embed = raw.match(EMBED);
        if (embed) return [{ type: "pageEmbed", attrs: { urn: urnOfUrl(embed[1]) ?? embed[1], label: "" } }];
        return paragraphs(token.tokens);
      }
      case "text":
        return paragraphs(token.tokens ?? [token]);
      default:
        return [];
    }
  });
}

export function fromMarkdown(source: string): DocNode {
  return { type: "doc", content: blocks(lex(source.replace(/\r\n/g, "\n"))) };
}

export interface MarkdownOptions {
  /** Writes bold, italic, code, strike and links as Markdown. Off for a line's plain text (`inlineMarkdown`). */
  readonly marks?: boolean;
  /** Mentions as `@label`, for a person reading (a version's diff), rather than the `[Label](urn)` that round-trips. */
  readonly labels?: boolean;
}

/** Marks that span neighbouring text; code and links wrap one text node, inside them. */
const SPANNING: Readonly<Record<string, string>> = { bold: "**", italic: "*", strike: "~~" };

function marked(node: DocNode, options: MarkdownOptions): string {
  let value = node.text ?? "";
  if (!options.marks || !value) return value;
  const marks = node.marks ?? [];
  if (marks.some((mark) => mark.type === "code")) value = `\`${value}\``;
  const href = marks.find((mark) => mark.type === "link")?.attrs?.href;
  return typeof href === "string" ? `[${value}](${href})` : value;
}

/** Inline nodes in a row. A mark shared by neighbours opens once, so `**a `b` c**` reads and parses back as one span. */
function inlineRun(children: readonly DocNode[], options: MarkdownOptions): string {
  if (!options.marks) return children.map((child) => inline(child, options)).join("");
  const open: string[] = [];
  let out = "";
  for (const child of children) {
    const wanted = (child.type === "text" ? (child.marks ?? []) : []).flatMap((mark) => SPANNING[mark.type] ?? []);
    let keep = 0;
    while (keep < open.length && wanted.includes(open[keep] as string)) keep++;
    while (open.length > keep) out += open.pop();
    for (const syntax of wanted) {
      if (open.includes(syntax)) continue;
      open.push(syntax);
      out += syntax;
    }
    out += inline(child, options);
  }
  while (open.length) out += open.pop();
  return out;
}

function inline(node: DocNode, options: MarkdownOptions): string {
  if (node.type === "text") return marked(node, options);
  if (node.type === MENTION) {
    const label = String(node.attrs?.label ?? "");
    const urn = String(node.attrs?.id ?? "");
    return options.labels || !urn ? `@${label || urn}` : formatRef({ urn, label });
  }
  if (node.type === EMOJI_NODE) return emojiNodeText(node.attrs);
  if (node.type === DATE_NODE) return dateNodeText(node.attrs);
  if (node.type === "hardBreak") return "\n";
  return inlineRun(node.content ?? [], options);
}

/** A block's inline content as one line of the round-trip Markdown: text, `[Label](urn)` mentions, no marks. */
export const inlineMarkdown = (node: DocNode) => inline(node, {});

const indent = (value: string, by: string) => value.replace(/\n/g, `\n${by}`);

function block(node: DocNode, options: MarkdownOptions): string {
  const children = node.content ?? [];
  const line = (child: DocNode) => inline(child, options);
  // An item's paragraph, then what is nested under it, indented to its text. Items of one list stay tight.
  const item = (child: DocNode, marker: string) => {
    const body = (child.content ?? []).map((part) => block(part, options)).join("\n");
    return marker + indent(body, " ".repeat(marker.length));
  };
  const cell = (child: DocNode) => line(child).replace(/\n/g, " ").replace(/\|/g, "\\|");
  const row = (child: DocNode) => `| ${(child.content ?? []).map(cell).join(" | ")} |`;
  switch (node.type) {
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${line(node)}`;
    case "bulletList":
      return children.map((child) => item(child, "- ")).join("\n");
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      return children.map((child, i) => item(child, `${start + i}. `)).join("\n");
    }
    case "taskList":
      return children.map((child) => item(child, `- [${child.attrs?.checked ? "x" : " "}] `)).join("\n");
    case "blockquote":
      return children
        .map((child) => block(child, options))
        .join("\n\n")
        .split("\n")
        .map((value) => `> ${value}`.trimEnd())
        .join("\n");
    case "codeBlock":
      // Code is never marked up, whatever the options: `inline` without marks.
      return `\`\`\`${String(node.attrs?.language ?? "")}\n${inline(node, {})}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "details": {
      const [summary, content] = children;
      const title = summary ? line(summary).replace(/\n/g, " ") : "";
      const body = (content?.content ?? []).map((child) => block(child, options)).filter(Boolean);
      return [`<details>\n<summary>${title}</summary>`, ...body, "</details>"].join("\n\n");
    }
    case "pageEmbed":
      return `[embed ${urlOf(String(node.attrs?.urn ?? ""))}]`;
    case "viewBlock":
      return `[view ${String(node.attrs?.view ?? "")}]`;
    case "image":
      return `![${String(node.attrs?.alt ?? "")}](${String(node.attrs?.src ?? "")})`;
    case "table": {
      const [header, ...rows] = children;
      if (!header) return "";
      const divider = `|${(header.content ?? []).map(() => "---").join("|")}|`;
      return [row(header), divider, ...rows.map(row)].join("\n");
    }
    default:
      return line(node);
  }
}

/** A body as Markdown. A Mermaid diagram is a code block in `mermaid`, and travels as a ```mermaid fence. */
export function toMarkdown(doc: DocNode, options: MarkdownOptions = {}): string {
  return (doc.content ?? []).map((child) => block(child, options)).join("\n\n");
}

/**
 * A comment's text as the editor's document: one paragraph, its lines joined by line breaks, its references as
 * mentions. No other Markdown: a comment is text.
 */
export function fromInline(source: string): DocNode {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const content = lines.flatMap((line, i) => [...(i ? [{ type: "hardBreak" }] : []), ...inlineNodes(line)]);
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

/** The editor's document as a comment's text: lines, mentions as `[Label](urn)`, no marks. */
export function toInline(doc: DocNode): string {
  return (doc.content ?? [])
    .map((child) => inline(child, {}))
    .join("\n")
    .trim();
}
