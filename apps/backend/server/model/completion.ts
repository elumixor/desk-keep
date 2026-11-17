/**
 * What the editor's completion asks the model, and how its answer is cleaned before it is shown as ghost text.
 * Pure: the editor builds the document with the cursor marked, the server adds the page's surroundings.
 */

/** Where the cursor is in the Markdown the editor sends; the model writes what goes there. */
export const CURSOR = "<|cursor|>";
/** The document is cut around the cursor to this many characters each way: the rest is too far to matter. */
const BEFORE_LIMIT = 6000;
const AFTER_LIMIT = 1500;
/** The longest completion worth showing; a longer one is cut at its last line end. */
const MAX_LENGTH = 400;

export interface RelatedPage {
  readonly title: string;
  /** Ancestors' titles, from the workspace down. */
  readonly path: readonly string[];
  readonly text: string;
}

export interface CompletionContext {
  readonly title: string;
  readonly path: readonly string[];
  /** The page's property values that read as text, by name. */
  readonly properties: Readonly<Record<string, string>>;
  readonly siblings: readonly string[];
  readonly children: readonly string[];
  /** Pages this one mentions, then pages the search found for what is being written. */
  readonly related: readonly RelatedPage[];
}

export const SYSTEM_PROMPT = `You are the inline autocomplete of Keep, a workspace of pages (projects, tasks, docs) written in Markdown.
The user is typing; you are given the page with ${CURSOR} where their cursor is, plus what is around the page.

Write only the text that belongs at ${CURSOR}: the rest of the current word, sentence, bullet, row or line, and at most a few short lines after it when the structure clearly asks for more (the next bullets of a list, the next row of a table, the closing of a code block).
Match exactly what is there: the language the page is written in, its tone, its terms and names, its Markdown (a bullet starts with "- ", a task with "- [ ] ", a heading with "#", a table row with "|", code stays code in the fence's language) and its indentation.
Prefer facts from the page and the related pages over invention; never make up names, numbers, dates or links.
Keep it short: usually the rest of the line, a few lines only when the structure asks for them. Stop where the user would naturally pause.
Spacing is yours to write: start with a space when the word before ${CURSOR} is whole and a new word follows ("Some" + " people are…"), with no space when you finish that word ("Some" + "times…").
You are not talking to the user: never comment on the page, explain, apologise or suggest; write the words themselves, as its author would.
Answer with the completion text alone: no ${CURSOR}, no quotes or fence around it, nothing repeated from before the cursor.
When nothing worth suggesting follows (the text is complete, or you cannot tell what comes next), answer with nothing at all.`;

const cut = (text: string, limit: number) => (text.length > limit ? `…${text.slice(-limit)}` : text);
/** The start of some text, `…` marking what was left out. */
export const excerpt = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

/** What the document says before the cursor and after it. */
function aroundCursor(document: string) {
  const at = document.indexOf(CURSOR);
  return at === -1
    ? { before: document, after: "" }
    : { before: document.slice(0, at), after: document.slice(at + CURSOR.length) };
}

function section(title: string, lines: readonly string[]) {
  return lines.length ? `## ${title}\n${lines.join("\n")}` : null;
}

/** The message: the page's surroundings first (they are the same from one keystroke to the next), then the page. */
export function userPrompt(document: string, context: CompletionContext): string {
  const { before, after } = aroundCursor(document);
  const page = `${cut(before, BEFORE_LIMIT)}${CURSOR}${excerpt(after, AFTER_LIMIT)}`;
  const where = [...context.path, context.title || "Untitled"].join(" › ");
  const parts = [
    `# Page\n${where}`,
    section(
      "Properties",
      Object.entries(context.properties).map(([name, value]) => `- ${name}: ${value}`),
    ),
    section(
      "Pages next to it",
      context.siblings.map((title) => `- ${title}`),
    ),
    section(
      "Pages under it",
      context.children.map((title) => `- ${title}`),
    ),
    ...context.related.map(
      (related) => `## Related page: ${[...related.path, related.title].join(" › ")}\n${related.text}`,
    ),
    `# The page, with the cursor\n${page}`,
  ];
  return parts.filter((part): part is string => part !== null).join("\n\n");
}

const FENCE = /^```[\w-]*\n([\s\S]*?)\n?```$/;

/** Shared start of `text` and the end of `before`, the longest: the model repeating what it was given. */
function overlap(before: string, text: string) {
  const most = Math.min(before.length, text.length);
  for (let n = most; n > 0; n--) if (before.endsWith(text.slice(0, n))) return n;
  return 0;
}

/**
 * The model's answer as the text to show: no fence around it, nothing it repeated from before the cursor or from
 * after it, no cursor marker, no trailing blank, and cut to a length the eye can take in at once.
 */
export function clean(raw: string, document: string): string {
  const { before, after } = aroundCursor(document);
  let text = raw.replace(/\r\n/g, "\n");
  const fenced = text.trim().match(FENCE);
  if (fenced && !before.trimEnd().endsWith("```") && !/```\w*$/.test(before.trimEnd())) text = fenced[1];
  text = text.replaceAll(CURSOR, "");
  if (!before.endsWith(" ") && !before.endsWith("\n")) {
    const repeated = overlap(before, text);
    // A whole repeated word or more is the model echoing; a few shared letters are the word going on.
    if (repeated >= 3) text = text.slice(repeated);
  }
  if (after) {
    const next = after.split("\n")[0];
    if (next && text.endsWith(next)) text = text.slice(0, -next.length);
  }
  text = text.trimEnd();
  if (!before.endsWith("\n")) text = text.replace(/^\n+/, before.endsWith(" ") ? "" : "\n");
  if (before.endsWith("\n")) text = text.replace(/^\n+/, "");
  if (text.length > MAX_LENGTH) {
    const end = text.lastIndexOf("\n", MAX_LENGTH);
    text = end > 0 ? text.slice(0, end) : text.slice(0, MAX_LENGTH);
  }
  return text;
}
