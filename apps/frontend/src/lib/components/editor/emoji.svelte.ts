import { type Editor, InputRule, mergeAttributes, Node } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { mount, unmount } from "svelte";
import { shortcodeEmoji } from "$lib/emoji";
import { POPUP } from "$lib/popup";
import { emoji } from "$lib/stores/emoji.svelte";
import { EMOJI_NODE, emojiNodeText, formatIcon, parseIcon } from "$model/icons";
import EmojiPicker from "../ui/EmojiPicker.svelte";
import InlineEmoji from "./InlineEmoji.svelte";
import { inBody } from "./title";

/** What `:` hands the editor: the icon picked, as it is stored. */
interface EmojiPick {
  readonly icon: string;
}

const GAP = 4;
const MARGIN = 8;

/**
 * An icon as editor content: a Unicode emoji is plain text, anything else the inline `emoji` node. In the title every
 * icon is the node (`node`), so the page's icon there can be clicked to change it.
 */
function content(icon: string, node = false) {
  const parsed = parseIcon(icon);
  if (parsed?.kind === "emoji" && !node) return parsed.emoji;
  const name =
    parsed?.kind === "custom" ? (emoji.get(parsed.id)?.name ?? "") : parsed?.kind === "lucide" ? parsed.name : "";
  return { type: EMOJI_NODE, attrs: { icon, name } };
}

/** The floating box `/emoji` and `:` show the picker in. */
function pickerHost() {
  const host = document.createElement("div");
  host.className = `fixed z-50 w-[22rem] max-w-[calc(100vw-1rem)] text-left ${POPUP}`;
  document.body.append(host);
  return host;
}

/** The picker under the caret, or over it where there is no room below. */
function place(host: HTMLElement, caret: { left: number; top: number; bottom: number }) {
  const { offsetWidth: w, offsetHeight: h } = host;
  const left = Math.min(Math.max(MARGIN, caret.left), innerWidth - w - MARGIN);
  const below = caret.bottom + GAP;
  const top = below + h > innerHeight - MARGIN && caret.top - h - GAP > MARGIN ? caret.top - h - GAP : below;
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

/** Where a picker opened somewhere other than the caret is shown, and what it does with what is picked. */
interface PickerPlace {
  readonly under: { left: number; top: number; bottom: number };
  readonly onpick: (icon: string) => void;
  readonly onremove?: () => void;
}

/**
 * The picker `/emoji` opens at the caret; what is picked goes where the caret was. Given `elsewhere`, it shows there
 * instead and hands what is picked (or the removal) to it.
 */
export function openEmojiPicker(editor: Editor, elsewhere?: PickerPlace) {
  const at = editor.state.selection.from;
  const caret = elsewhere?.under ?? editor.view.coordsAtPos(at);
  const host = pickerHost();
  const close = () => {
    removeEventListener("mousedown", outside, true);
    removeEventListener("keydown", onEscape);
    void unmount(picker);
    host.remove();
  };
  const outside = (event: MouseEvent) => {
    if (!host.contains(event.target as globalThis.Node)) close();
  };
  // Not captured, so Escape in the add-emoji dialog closes only that.
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    editor.commands.focus(at);
  };

  const onremove = elsewhere?.onremove;
  const picker = mount(EmojiPicker, {
    target: host,
    props: {
      onpick: (icon: string) => {
        close();
        if (elsewhere) elsewhere.onpick(icon);
        else editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), content(icon)).run();
      },
      onremove: onremove
        ? () => {
            close();
            onremove();
          }
        : undefined,
    },
  });
  addEventListener("mousedown", outside, true);
  addEventListener("keydown", onEscape);
  place(host, caret);
  requestAnimationFrame(() => place(host, caret));
}

/** The picker for the page's icon, under `anchor`: it changes the title's icon, or takes it out. */
export function pickPageIcon(editor: Editor, anchor: Element, set: (icon: string | null) => void) {
  openEmojiPicker(editor, {
    under: anchor.getBoundingClientRect(),
    onpick: set,
    onremove: () => set(null),
  });
}

/**
 * What `:` shows: the picker under the caret, searched by what follows the `:`. The keys stay the editor's: the arrows
 * and Enter reach the picker and Escape closes it. A bare `:` shows it to browse; once something is typed it
 * hides while nothing matches (until a button in it is pressed), so a `:` that starts no emoji takes no key.
 */
function pickerMenu() {
  let host: HTMLDivElement | null = null;
  let picker: { keydown: (event: KeyboardEvent) => boolean } | null = null;
  let props: SuggestionProps<EmojiPick> | null = null;
  let touched = false;
  const view = $state({ typed: "", count: 0 });

  const draw = () => {
    const rect = props?.clientRect?.();
    if (!host || !rect) return;
    host.hidden = !view.count && !touched && !!view.typed;
    place(host, rect);
  };
  const close = () => {
    if (picker) void unmount(picker);
    host?.remove();
    picker = null;
    host = null;
  };

  return {
    onStart(next: SuggestionProps<EmojiPick>) {
      props = next;
      view.typed = next.query;
      view.count = 0;
      touched = false;
      host = pickerHost();
      host.hidden = true;
      // Pressing a tab, a colour or a cell keeps the caret in the page, so typing goes on searching.
      host.addEventListener("mousedown", (event) => {
        if (!(event.target as Element).closest("button")) return;
        event.preventDefault();
        touched = true;
      });
      picker = mount(EmojiPicker, {
        target: host,
        props: {
          get typed() {
            return view.typed;
          },
          onresults: (count: number) => {
            view.count = count;
            requestAnimationFrame(draw);
          },
          onpick: (icon: string) => props?.command({ icon }),
          // Nothing is picked: the `:` and what was typed after it go.
          onremove: () => props?.editor.chain().focus().deleteRange(props.range).run(),
        },
      });
    },
    onUpdate(next: SuggestionProps<EmojiPick>) {
      props = next;
      view.typed = next.query;
      requestAnimationFrame(draw);
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (!host || !picker || host.hidden) return false;
      if (event.key !== "Escape") return picker.keydown(event);
      close();
      return true;
    },
    onExit() {
      close();
      props = null;
    },
  };
}

const EMOJI_KEY = new PluginKey("emojiMenu");
/** `:name:` typed in full, after a space or at the start of a line. */
const SHORTCODE = /(?:^|\s)(:([a-z0-9_+-]+):)$/;

/**
 * An emoji in a line of text. A Unicode one is just text; a custom or animated emoji, or a Lucide icon, is this node,
 * drawn by `IconGlyph`. `:` opens the icon picker, searched by what follows, and `:name:` typed in full
 * becomes its emoji.
 */
export const EmojiNode = Node.create({
  name: EMOJI_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  // Ahead of Vim, like the other menus: Escape closes the open menu before it leaves insert mode.
  priority: 101,

  addAttributes() {
    return {
      icon: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-icon"),
        renderHTML: (attributes) => ({ "data-icon": attributes.icon }),
      },
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-name") ?? "",
        renderHTML: (attributes) => (attributes.name ? { "data-name": attributes.name } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-emoji]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-emoji": "" }), emojiNodeText(node.attrs)];
  },

  renderText({ node }) {
    return emojiNodeText(node.attrs);
  },

  renderMarkdown(node) {
    return emojiNodeText(node.attrs);
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "inline-emoji";
      dom.contentEditable = "false";
      const glyph = mount(InlineEmoji, {
        target: dom,
        props: { icon: node.attrs.icon, fallback: emojiNodeText(node.attrs) },
      });
      return { dom, destroy: () => void unmount(glyph) };
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: SHORTCODE,
        handler: ({ state, range, match }) => {
          const [whole = "", typed = "", name = ""] = match;
          const custom = emoji.byName(name);
          const unicode = custom ? undefined : shortcodeEmoji(name);
          if (!custom && !unicode) return null;
          const from = range.from + whole.length - typed.length;
          if (unicode) state.tr.insertText(unicode, from, range.to);
          else if (custom)
            state.tr.replaceWith(
              from,
              range.to,
              this.type.create({ icon: formatIcon({ kind: "custom", id: custom.id }), name: custom.name }),
            );
          return undefined;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<EmojiPick>({
        editor: this.editor,
        pluginKey: EMOJI_KEY,
        char: ":",
        minQueryLength: 0,
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        // The picker finds what matches itself.
        items: () => [],
        command: ({ editor, range, props }) =>
          editor
            .chain()
            .focus()
            .insertContentAt(range, content(props.icon, !inBody(editor.state, range.from)))
            .run(),
        render: pickerMenu,
      }),
    ];
  },
});
