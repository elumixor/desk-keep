import { vimPluginKey } from "@desk/editor";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { CURSOR } from "$model/completion";
import type { DocNode } from "$model/document";
import { toMarkdown } from "$model/markdown";
import { inBody } from "./title";

export interface CompletionOptions {
  /**
   * What the model writes at the cursor of `document` (Markdown with `CURSOR` in it), given to `onText` as it grows:
   * each time the whole text so far.
   */
  request: (document: string, signal: AbortSignal, onText: (text: string) => void) => Promise<void>;
  enabled: () => boolean;
}

/** Typing pauses this long before the editor asks. */
const DEBOUNCE_MS = 200;
const GHOST_CLASS = "completion-ghost";

interface Ghost {
  readonly pos: number;
  readonly text: string;
}

const key = new PluginKey<Ghost | null>("completion");

/** The ghost after this transaction: shortened by what was typed into it, gone when anything else changed. */
function carried(ghost: Ghost | null, tr: Transaction): Ghost | null {
  if (!ghost) return null;
  if (!tr.docChanged) return tr.selectionSet && tr.selection.from !== ghost.pos ? null : ghost;
  const pos = tr.mapping.map(ghost.pos);
  const typed = pos > ghost.pos ? tr.doc.textBetween(ghost.pos, pos, "\n") : "";
  if (!typed || !ghost.text.startsWith(typed) || tr.selection.from !== pos) return null;
  const text = ghost.text.slice(typed.length);
  return text ? { pos, text } : null;
}

/** The page as Markdown with the cursor marked, for the model. */
function documentAt(view: EditorView) {
  const { state } = view;
  const doc = state.tr.insertText(CURSOR, state.selection.from).doc.toJSON() as DocNode;
  return toMarkdown(doc, { marks: true });
}

/** Where ghost text makes sense: a caret in text, in insert mode when Vim is on. */
function completable(view: EditorView, enabled: () => boolean) {
  const { state } = view;
  if (!view.editable || !enabled() || !state.selection.empty || !view.hasFocus()) return false;
  const vim = vimPluginKey.getState(state);
  if (vim && vim.mode !== "insert") return false;
  return state.selection.$from.parent.isTextblock && inBody(state, state.selection.from);
}

/**
 * Ghost text at the caret: after a pause in typing the page is sent to the model, and what it writes is shown
 * greyed at the cursor. Tab takes it, Escape or any other change drops it; typing the ghost's own letters keeps it.
 */
export const Completion = Extension.create<CompletionOptions>({
  name: "completion",
  // Before the list and code-block keymaps, so Tab takes a ghost instead of indenting; without one it falls through.
  priority: 1000,

  addOptions() {
    return { request: async () => {}, enabled: () => false };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const ghost = key.getState(this.editor.state);
        if (!ghost) return false;
        const { text, pos } = ghost;
        const chain = this.editor.chain().focus().setMeta(key, null);
        if (text.includes("\n")) chain.insertContentAt(pos, text, { contentType: "markdown" });
        else chain.insertContentAt(pos, text);
        return chain.run();
      },
      Escape: () => {
        if (!key.getState(this.editor.state)) return false;
        this.editor.view.dispatch(this.editor.state.tr.setMeta(key, null));
        // Not handled: Escape still leaves insert mode, closes a menu, whatever else it does.
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const { request, enabled } = this.options;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight: AbortController | null = null;

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      inflight?.abort();
      inflight = null;
    };

    const ask = (view: EditorView) => {
      if (!completable(view, enabled)) return;
      const pos = view.state.selection.from;
      const document = documentAt(view);
      const controller = new AbortController();
      inflight = controller;
      const show = (text: string) => {
        if (controller.signal.aborted || !text) return;
        // The answer is for the page as it was when asked: anything typed since makes it stale.
        if (view.state.selection.from !== pos || documentAt(view) !== document) {
          controller.abort();
          return;
        }
        view.dispatch(view.state.tr.setMeta(key, { pos, text } satisfies Ghost));
      };
      request(document, controller.signal, show)
        .catch((error: unknown) => {
          if (!controller.signal.aborted) console.warn("[completion]", error);
        })
        .finally(() => {
          if (inflight === controller) inflight = null;
        });
    };

    return [
      new Plugin<Ghost | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, ghost) => {
            const set = tr.getMeta(key) as Ghost | null | undefined;
            return set === undefined ? carried(ghost, tr) : set;
          },
        },
        props: {
          decorations(state) {
            const ghost = key.getState(state);
            if (!ghost) return null;
            const widget = Decoration.widget(
              ghost.pos,
              () => {
                const span = window.document.createElement("span");
                span.className = GHOST_CLASS;
                span.textContent = ghost.text;
                return span;
              },
              { side: 1, key: `${ghost.pos}:${ghost.text}` },
            );
            return DecorationSet.create(state.doc, [widget]);
          },
        },
        view: (view) => ({
          update: (_view, previous) => {
            if (view.state.doc.eq(previous.doc)) return;
            cancel();
            // A ghost that survived the change (its own letters were typed) stays; otherwise ask once typing pauses.
            if (key.getState(view.state) === null) timer = setTimeout(() => ask(view), DEBOUNCE_MS);
          },
          destroy: cancel,
        }),
      }),
    ];
  },
});
