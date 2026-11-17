import { type Editor, getMarkRange, type Range } from "@tiptap/core";
import { caretPopup } from "./caret-popup";
import LinkMenu from "./LinkMenu.svelte";
import type { LinkEdit } from "./link";

/**
 * The menu ⌘U opens under the caret: for the link the caret is in, the selected text, or a link to put at the caret.
 * Enter in it keeps the address and text.
 */
export function openLinkMenu(editor: Editor) {
  const { state } = editor;
  const type = state.schema.marks.link;
  if (!type) return;
  const { from, to, empty } = state.selection;
  const found = getMarkRange(state.doc.resolve(from), type);
  const existing = !!found && found.from <= from && to <= found.to;
  let range: Range | null = existing ? found : empty ? null : { from, to };
  const attrs = existing ? editor.getAttributes("link") : {};
  const original = range ? state.doc.textBetween(range.from, range.to) : "";
  const initial: LinkEdit = {
    href: typeof attrs.href === "string" ? attrs.href : "",
    text: original,
  };

  caretPopup(
    editor,
    range?.from ?? from,
    LinkMenu,
    (close) => ({
      initial,
      existing,
      onapply: (edit: LinkEdit) => {
        const mark = { href: edit.href };
        const text = edit.text || (range ? original : "") || edit.href;
        const chain = editor.chain();
        if (range && text === editor.state.doc.textBetween(range.from, range.to))
          chain.setTextSelection(range).setMark("link", mark);
        else {
          const at = range?.from ?? from;
          chain.insertContentAt(range ?? from, { type: "text", text, marks: [{ type: "link", attrs: mark }] });
          range = { from: at, to: at + text.length };
        }
        // Typing on after the link is not part of it.
        chain
          .setTextSelection(range.to)
          .command(({ tr }) => {
            tr.removeStoredMark(type);
            return true;
          })
          .setMeta("preventAutolink", true)
          .run();
        close(true);
      },
      onremove: () => {
        if (range) editor.chain().setTextSelection(range).unsetMark("link").run();
        close(true);
      },
    }),
    () => range?.to ?? from,
  );
}
