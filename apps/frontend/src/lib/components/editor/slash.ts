import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import {
  AtSign,
  CalendarDays,
  ChevronRight,
  Code,
  CornerDownLeft,
  FilePlus,
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Smile,
  Table,
  Table2,
  TextQuote,
  Workflow,
} from "lucide-svelte";
import { MERMAID_LANGUAGE, MERMAID_SAMPLE } from "$lib/mermaid";
import { confirm } from "$lib/stores/confirm.svelte";
import { createView } from "$lib/views";
import { DATE_NODE, isoDay } from "$model/dates";
import { justEdited } from "./edited";
import { openEmojiPicker } from "./emoji.svelte";
import { type MenuItem, menuRenderer } from "./menu.svelte";
import { inBody } from "./title";
import { VIEW_BLOCK } from "./view-block";

interface Block extends MenuItem {
  /** Other words the block is found by. */
  readonly aliases?: readonly string[];
  readonly run: (editor: Editor, range: Range, pageId: string) => void;
}

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

const BASIC = "Basic blocks";
const MEDIA = "Media";
const PAGES = "Pages";

const BLOCKS: readonly Block[] = [
  {
    group: BASIC,
    label: "Text",
    icon: Pilcrow,
    description: "Plain writing",
    run: (e, r) => chain(e, r).setParagraph().run(),
  },
  {
    group: BASIC,
    label: "Heading 1",
    icon: Heading1,
    description: "Big section heading",
    hint: "#",
    run: (e, r) => chain(e, r).setNode("heading", { level: 1 }).run(),
  },
  {
    group: BASIC,
    label: "Heading 2",
    icon: Heading2,
    description: "Medium section heading",
    hint: "##",
    run: (e, r) => chain(e, r).setNode("heading", { level: 2 }).run(),
  },
  {
    group: BASIC,
    label: "Heading 3",
    icon: Heading3,
    description: "Small section heading",
    hint: "###",
    run: (e, r) => chain(e, r).setNode("heading", { level: 3 }).run(),
  },
  {
    group: BASIC,
    label: "Bulleted list",
    icon: List,
    description: "A simple list",
    hint: "-",
    run: (e, r) => chain(e, r).toggleBulletList().run(),
  },
  {
    group: BASIC,
    label: "Numbered list",
    icon: ListOrdered,
    description: "A list with numbers",
    hint: "1.",
    run: (e, r) => chain(e, r).toggleOrderedList().run(),
  },
  {
    group: BASIC,
    label: "Checklist",
    icon: ListTodo,
    description: "Tasks to tick off",
    hint: "[]",
    run: (e, r) => chain(e, r).toggleTaskList().run(),
  },
  {
    group: BASIC,
    label: "Quote",
    icon: TextQuote,
    description: "Set a quote apart",
    hint: ">",
    run: (e, r) => chain(e, r).toggleBlockquote().run(),
  },
  {
    group: BASIC,
    label: "Toggle",
    aliases: ["details", "collapse", "fold"],
    icon: ChevronRight,
    description: "A section that opens and closes",
    run: (e, r) => chain(e, r).setDetails().run(),
  },
  {
    group: BASIC,
    label: "Divider",
    aliases: ["hr", "line", "rule"],
    icon: Minus,
    description: "A line between blocks",
    hint: "---",
    run: (e, r) => chain(e, r).setHorizontalRule().run(),
  },
  {
    group: BASIC,
    label: "Line break",
    aliases: ["br", "newline"],
    icon: CornerDownLeft,
    description: "A new line in the same block",
    hint: "Shift+Enter",
    run: (e, r) => chain(e, r).setHardBreak().run(),
  },
  {
    group: MEDIA,
    label: "Code",
    icon: Code,
    description: "A block of code",
    hint: "```",
    run: (e, r) => chain(e, r).toggleCodeBlock().run(),
  },
  {
    group: MEDIA,
    label: "Diagram",
    icon: Workflow,
    description: "Mermaid, drawn as you type",
    hint: "```mermaid",
    run: (e, r) =>
      chain(e, r)
        .insertContent({
          type: "codeBlock",
          attrs: { language: MERMAID_LANGUAGE },
          content: [{ type: "text", text: MERMAID_SAMPLE }],
        })
        .run(),
  },
  {
    group: MEDIA,
    label: "Emoji",
    aliases: ["icon"],
    icon: Smile,
    description: "Emoji, animated emoji and icons",
    hint: ":",
    run: (e, r) => {
      chain(e, r).run();
      openEmojiPicker(e);
    },
  },
  {
    group: MEDIA,
    label: "Table",
    icon: Table,
    description: "Three rows, three columns",
    run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    group: MEDIA,
    label: "Image",
    icon: Image,
    description: "From a link",
    run: (e, r) => {
      confirm.prompt("Image address", "Insert", (src) => chain(e, r).setImage({ src }).run());
    },
  },
  {
    group: BASIC,
    label: "Date",
    aliases: ["today", "tomorrow", "day"],
    icon: CalendarDays,
    description: "Today's date, as a date",
    hint: "@today",
    run: (e, r) =>
      chain(e, r)
        .insertContent([
          { type: DATE_NODE, attrs: { date: isoDay(new Date()) } },
          { type: "text", text: " " },
        ])
        .run(),
  },
  {
    group: PAGES,
    label: "Page",
    aliases: ["subpage", "child page", "new page"],
    icon: FilePlus,
    description: "A new page inside this one, linked here",
    hint: "+",
    run: (e, r) => chain(e, r).insertContent("+").run(),
  },
  {
    group: PAGES,
    label: "View",
    icon: Table2,
    description: "A table of the pages under this one, shown here",
    run: (e, r, pageId) => {
      chain(e, r).run();
      void createView(pageId, "table", { under: pageId }).then(({ id }) =>
        e
          .chain()
          .focus()
          .insertContent({ type: VIEW_BLOCK, attrs: { view: id } })
          .run(),
      );
    },
  },
  {
    group: PAGES,
    label: "Mention a page",
    icon: AtSign,
    description: "Link to a page inline",
    hint: "@",
    run: (e, r) => chain(e, r).insertContent("@").run(),
  },
];

/** `/` at the start of anything offers every block type. */
export const SlashMenu = Extension.create<{ pageId: string }>({
  name: "slashMenu",
  // Ahead of Vim, like the mention menu: Escape closes the open menu before it leaves insert mode.
  priority: 101,
  addOptions() {
    return { pageId: "" };
  },
  addProseMirrorPlugins() {
    const pageId = this.options.pageId;
    return [
      Suggestion<Block>({
        editor: this.editor,
        pluginKey: new PluginKey("slashMenu"),
        char: "/",
        startOfLine: false,
        // Navigating onto an existing `/word` must not open the menu: only an edit may.
        allow: ({ state, range, isActive }) => inBody(state, range.from) && (isActive || justEdited(state)),
        items: ({ query }) => {
          const q = query.toLowerCase();
          return BLOCKS.filter(
            (b) => b.label.toLowerCase().includes(q) || b.aliases?.some((alias) => alias.startsWith(q)),
          );
        },
        command: ({ editor, range, props }) => props.run(editor, range, pageId),
        render: menuRenderer<Block>,
      }),
    ];
  },
});
