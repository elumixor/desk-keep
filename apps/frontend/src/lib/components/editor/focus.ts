import type { Editor } from "@tiptap/core";
import { TITLE } from "./title";

let current: Editor | null = null;

export const registerEditor = (editor: Editor | null) => {
  current = editor;
};

/** Where a caret starts: the first character of the body, or of the title when it is alone (a trait's or view's). */
export function startOf(editor: Editor) {
  const alone = editor.extensionManager.extensions.find((e) => e.name === TITLE)?.options.alone;
  return alone ? 1 : editor.state.doc.child(0).nodeSize + 1;
}

/** Focuses the open page's editor, its caret at the start unless one was placed. */
export function focusEditor() {
  if (!current || current.isDestroyed) return;
  if (current.state.selection.from > 1) return void current.commands.focus();
  current.commands.focus(startOf(current));
}
