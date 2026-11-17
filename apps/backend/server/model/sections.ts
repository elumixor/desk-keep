import type { DocNode } from "./document";
import { inlineMarkdown, type MarkdownOptions, toMarkdown } from "./markdown";

/**
 * A body read by its headings, so an assistant can look at a long page's outline and then read one part of it.
 * Only the body's own top-level headings count: a `#` line inside a code block is code, and a heading inside a toggle
 * or a quote belongs to that block.
 */
export interface Heading {
  /** The heading line as Markdown, like `## Plan`. */
  readonly heading: string;
  /** How long its section is as Markdown: the heading to the next one of the same or a higher level. */
  readonly chars: number;
}

interface Section {
  readonly level: number;
  readonly title: string;
  readonly nodes: readonly DocNode[];
}

const levelOf = (node: DocNode) => (node.type === "heading" ? Number(node.attrs?.level ?? 1) : null);

/** Each top-level heading with the blocks under it, up to the next heading of the same or a higher level. */
function sections(doc: DocNode): Section[] {
  const blocks = doc.content ?? [];
  return blocks.flatMap((node, start) => {
    const level = levelOf(node);
    if (level === null) return [];
    const after = blocks.slice(start + 1);
    const end = after.findIndex((next) => {
      const nextLevel = levelOf(next);
      return nextLevel !== null && nextLevel <= level;
    });
    return [{ level, title: inlineMarkdown(node), nodes: [node, ...(end < 0 ? after : after.slice(0, end))] }];
  });
}

const asMarkdown = (nodes: readonly DocNode[], options: MarkdownOptions) =>
  toMarkdown({ type: "doc", content: nodes }, options);

export const outline = (doc: DocNode, options: MarkdownOptions = {}): Heading[] =>
  sections(doc).map(({ level, title, nodes }) => ({
    heading: `${"#".repeat(level)} ${title}`,
    chars: asMarkdown(nodes, options).length,
  }));

const normalized = (title: string) => title.replace(/^#+/, "").trim().toLowerCase();

/**
 * The section a title names, as Markdown: the heading whose text is the title, case aside, else the first one that
 * contains it. Null when no heading does.
 */
export function section(doc: DocNode, title: string, options: MarkdownOptions = {}): string | null {
  const wanted = normalized(title);
  const all = sections(doc);
  const found =
    all.find((s) => normalized(s.title) === wanted) ?? all.find((s) => normalized(s.title).includes(wanted));
  return found ? asMarkdown(found.nodes, options) : null;
}
