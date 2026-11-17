import {
  CodeSelection,
  type LineNumbers,
  MarkdownPaste,
  MoveBlock,
  TrailingParagraph,
  type VimPrompt,
  vimExtensions,
} from "@desk/editor";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { visits } from "$lib/stores/visits.svelte";
import { ChildPage } from "./child-page";
import { KeepCodeBlock } from "./code-block";
import { Completion } from "./completion";
import { requestCompletion } from "./completion-request";
import { DateNode } from "./date.svelte";
import { EditTracker } from "./edited";
import { EmojiNode } from "./emoji.svelte";
import { LEADER } from "./leader";
import { KeepLink, KeepUnderline } from "./link";
import { mentionSuggestion } from "./mention-suggestion";
import { OpenOnEnter } from "./open-on-enter";
import { PageEmbed } from "./page-embed";
import { mentionLinks, mentionOfHref } from "./page-link";
import { PageMention } from "./page-mention";
import { SlashMenu } from "./slash";
import { PageDocument, Title } from "./title";
import { ViewBlock } from "./view-block";

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

function toggleButton({ element, isOpen }: { element: HTMLElement; isOpen: boolean }) {
  if (!element.firstChild) element.innerHTML = CHEVRON;
  element.contentEditable = "false";
  element.setAttribute("aria-label", isOpen ? "Collapse" : "Expand");
  element.setAttribute("aria-expanded", String(isOpen));
}

/**
 * Every block and behaviour the page editor has; `href` turns a URN into the link a mention or embed opens, `pageId`
 * is the page the body belongs to (a view placed in it is that page's); `vim` turns on Vim mode, `onPrompt` opening the bar
 * `/`, `?` and `:` type into, and `scrolloff` the lines kept around the cursor; `completion` says whether ghost text is on;
 * `head` is what the title's line carries around it (see `title.ts`).
 */
export function extensions(
  href: (urn: string) => string,
  pageId: string,
  editable: () => boolean,
  vim: {
    onPrompt: VimPrompt;
    scrolloff: () => number;
    lineNumbers: () => LineNumbers;
    numbersSide: () => "left" | "right";
  } | null,
  completion: () => boolean,
  head: () => HTMLElement | undefined,
  /** A trait's or view's title alone, with no body. */
  brief = false,
) {
  return [
    StarterKit.configure({ document: false, link: false, underline: false, codeBlock: false }),
    KeepLink.configure({ openOnClick: false, autolink: true }),
    KeepUnderline,
    PageDocument,
    Title.configure({ head, alone: brief }),
    KeepCodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    // A toggle: starts closed, and whether it is open is the reader's, not the page's.
    Details.configure({ renderToggleButton: toggleButton }),
    DetailsSummary,
    DetailsContent,
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({
      // Every empty line is offered it, so an empty page says what to do even unfocused; other lines only at the caret.
      showOnlyCurrent: false,
      // The title draws its own ("Untitled").
      placeholder: ({ editor, node, hasAnchor }) =>
        node.type.name === "title"
          ? ""
          : editor.state.doc.childCount === 2 && editor.state.doc.child(1) === node
            ? "Write, or press / for blocks, @ to mention a page, a person or a date"
            : !hasAnchor
              ? ""
              : node.type.name === "heading"
                ? `Heading ${node.attrs.level}`
                : "Press / for blocks",
    }),
    Markdown,
    // A page's address alone is a mention of it; Markdown with such links has them as mentions.
    MarkdownPaste.configure({ address: mentionOfHref, transform: mentionLinks }),
    CodeSelection,
    MoveBlock,
    EditTracker,
    SlashMenu.configure({ pageId }),
    ChildPage.configure({ pageId }),
    PageEmbed.configure({ href }),
    OpenOnEnter.configure({ href }),
    EmojiNode,
    DateNode,
    TrailingParagraph,
    ViewBlock.configure({ pageId, editable }),
    PageMention.configure({
      HTMLAttributes: { class: "mention item-inline" },
      suggestion: mentionSuggestion(pageId),
    }),
    ...(vim
      ? vimExtensions({
          ...vim,
          ...(brief ? { lineNumbers: () => "off" as const } : {}),
          leader: LEADER,
          jumps: visits,
        })
      : []),
    Completion.configure({
      enabled: completion,
      request: (document, signal, onText) => requestCompletion(pageId, document, signal, onText),
    }),
  ];
}
