import { DATE_NODE, dateNodeText } from "./dates";
import { type DocNode, MENTION } from "./document";
import { EMOJI_NODE, emojiNodeText } from "./icons";

/**
 * A page's title as the editor's first line: text, emoji and `@` mentions, emoji being part of the title like any
 * text (the page's icon is set apart, above it). A page keeps it as its plain `title`. When that cannot give the line
 * back as it was (a mention, an emoji node), the line itself is kept too, in the body's `attrs.title`; it is shown
 * only while it still says the title the page has, so a rename elsewhere wins.
 */
export type TitleLine = readonly DocNode[];

const textOf = (node: DocNode) =>
  node.type === "text"
    ? (node.text ?? "")
    : node.type === MENTION
      ? String(node.attrs?.label ?? "")
      : node.type === EMOJI_NODE
        ? emojiNodeText(node.attrs)
        : node.type === DATE_NODE
          ? dateNodeText(node.attrs)
          : "";

/** The plain title a line says. */
export const readTitle = (line: TitleLine): string => line.map(textOf).join("").replace(/\s+/g, " ").trim();

/** The line a plain title makes. */
const composeTitle = (title: string): DocNode[] => (title ? [{ type: "text", text: title }] : []);

/** The line kept in a body, if any. */
export const savedTitle = (body: DocNode | null | undefined): TitleLine | null =>
  Array.isArray(body?.attrs?.title) ? (body.attrs.title as TitleLine) : null;

/** The line to show for a page: the one its body keeps while it still says the page's title, else the title's. */
export function titleLine(title: string, body: DocNode | null | undefined): TitleLine {
  const saved = savedTitle(body);
  return saved && readTitle(saved) === title ? saved : composeTitle(title);
}

/** Whether a line has to be kept as itself, its plain title not being enough to give it back. */
export const keepsLine = (line: TitleLine) => line.some((node) => node.type !== "text");
