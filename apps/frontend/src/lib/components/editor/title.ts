import { vimPluginKey } from "@desk/editor";
import { type KeyboardShortcutCommand, Node } from "@tiptap/core";
import { type EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import { DATE_NODE } from "$model/dates";
import { MENTION } from "$model/document";
import { EMOJI_NODE } from "$model/icons";

export const TITLE = "title";

/** The page as one document: its title, then its body. */
export const PageDocument = Node.create({ name: "doc", topNode: true, content: `${TITLE} block+` });

/** Whether a position is in the body rather than the title: menus and ghost text are the body's. */
export const inBody = (state: EditorState, pos: number) => state.doc.resolve(pos).parent.type.name !== TITLE;

type Json = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Json[] };

/** The title node for a line. */
export const toTitleNode = (line: Json[]): Json => {
  const kept = line.filter((node) => node.type !== "text" || node.text);
  return { type: TITLE, ...(kept.length ? { content: kept } : {}) };
};

/** The line a title node says. */
export const fromTitleNode = (node: Json | undefined): Json[] => node?.content ?? [];

/** Keys that edit, rather than Vim's own, which are handled before these outside Insert mode. */
const typing = (state: EditorState) => {
  const vim = vimPluginKey.getState(state);
  return !vim || vim.mode === "insert";
};

/**
 * The page title: the document's first line, drawn large. It holds text, emoji, dates and page mentions (see
 * `$model/title`). Its node view also carries what sits around it (`head`: the properties and views
 * below), which the editor leaves alone. Enter leaves it for the body, Backspace at the start of the body comes back
 * to its end. `alone`: a title with no body (a trait's or view's), so Enter and ArrowDown stay in it.
 */
export const Title = Node.create<{ head: () => HTMLElement | undefined; alone: boolean }>({
  name: TITLE,
  content: `(text | ${EMOJI_NODE} | ${MENTION} | ${DATE_NODE})*`,
  marks: "",
  defining: true,

  addOptions() {
    return { head: () => undefined, alone: false };
  },

  renderHTML() {
    return ["h1", { class: "page-title", "data-testid": "page-title" }, 0];
  },

  addNodeView() {
    const head = this.options.head;
    const editor = this.editor;
    return ({ node, getPos }) => {
      const dom = document.createElement("div");
      dom.dataset.pageHead = "";
      const h1 = document.createElement("h1");
      h1.className = "page-title";
      h1.dataset.testid = "page-title";
      const around = head();
      if (around) dom.append(around);
      const slot = around?.querySelector("[data-title-slot]");
      (slot ?? dom).append(h1);
      const draw = (next: typeof node) => h1.toggleAttribute("data-empty", !next.content.size);
      draw(node);
      // A click on the line past the text (or on the pill after it) puts the caret on its last character.
      h1.addEventListener("mousedown", (event) => {
        const range = document.createRange();
        range.selectNodeContents(h1);
        const last = [...range.getClientRects()].at(-1);
        const pos = getPos();
        if (!last || pos === undefined || event.clientY < last.top || event.clientX <= last.right) return;
        event.preventDefault();
        event.stopPropagation();
        const { state, view } = editor;
        const title = state.doc.nodeAt(pos);
        if (!title) return;
        const vim = vimPluginKey.getState(state);
        const end = pos + 1 + title.content.size;
        const at = vim && vim.mode !== "insert" && title.content.size ? end - 1 : end;
        view.focus();
        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)));
      });
      return {
        dom,
        contentDOM: h1,
        update: (next) => {
          if (next.type !== node.type) return false;
          draw(next);
          return true;
        },
        // Clicks and keys around the title are the icon's, the properties' and the views'.
        stopEvent: (event) => !h1.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) => mutation.type === "attributes" || !h1.contains(mutation.target),
        destroy: () => h1.remove(),
      };
    };
  },

  /** A title alone keeps the cursor in it: past its end (into the hidden body) it goes back to its last character. */
  addProseMirrorPlugins() {
    if (!this.options.alone) return [];
    return [
      new Plugin({
        // Only what is typed, deleted or pasted inside the title: nothing reaches the body.
        filterTransaction: (tr) =>
          !tr.docChanged || tr.getMeta("preventUpdate") || tr.doc.childCount === tr.before.childCount,
        appendTransaction: (_, __, state) => {
          const title = state.doc.child(0);
          const end = title.nodeSize - 1;
          const vim = vimPluginKey.getState(state);
          const last = vim && vim.mode !== "insert" && title.content.size ? end - 1 : end;
          const { from, to } = state.selection;
          if (from >= 1 && to <= last) return null;
          const clamp = (pos: number) => Math.min(Math.max(pos, 1), last);
          return state.tr.setSelection(TextSelection.create(state.doc, clamp(from), clamp(to)));
        },
      }),
    ];
  },

  addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> {
    const title = () => this.editor.state.doc.child(0);
    const inTitle = (state: EditorState) => state.selection.$head.parent.type === this.type;
    if (this.options.alone)
      return { Enter: ({ editor }) => inTitle(editor.state), ArrowDown: ({ editor }) => inTitle(editor.state) };
    return {
      // Notion's: at the end, into the empty line below if there is one; anywhere else the rest becomes the body's first line.
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { $head, empty } = state.selection;
        if ($head.parent.type !== this.type || !typing(state)) return false;
        const first = state.doc.child(1);
        if (
          empty &&
          $head.parentOffset === $head.parent.content.size &&
          first.type.name === "paragraph" &&
          !first.content.size
        ) {
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, title().nodeSize + 1)));
          return true;
        }
        const tr = state.tr.deleteSelection();
        const at = tr.selection.from;
        tr.split(at, 1, [{ type: state.schema.nodes.paragraph }]);
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
        return true;
      },
      Backspace: ({ editor }) => {
        const { state, view } = editor;
        const { $head, empty } = state.selection;
        if (!empty || !typing(state) || $head.depth !== 1 || $head.index(0) !== 1 || $head.parentOffset) return false;
        const tr = state.tr;
        if (!$head.parent.content.size && state.doc.childCount > 2) tr.delete($head.before(), $head.after());
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, title().nodeSize - 1)));
        return true;
      },
      Delete: ({ editor }) => {
        const { state, view } = editor;
        const { $head, empty } = state.selection;
        if (
          !empty ||
          !typing(state) ||
          $head.parent.type !== this.type ||
          $head.parentOffset !== $head.parent.content.size
        )
          return false;
        const first = state.doc.child(1);
        const at = title().nodeSize;
        if (first.type.name === "paragraph" && !first.content.size && state.doc.childCount > 2)
          view.dispatch(state.tr.delete(at, at + first.nodeSize));
        return true;
      },
    };
  },
});
