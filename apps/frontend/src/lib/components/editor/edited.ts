import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";

const key = new PluginKey<boolean>("edited");

/** Whether the last transaction changed the text: a menu opens on an edit, not on moving onto an old trigger. */
export const justEdited = (state: EditorState) => !!key.getState(state);

/** Keeps `justEdited`; ahead of the menus, whose state reads it while the same transaction is applied. */
export const EditTracker = Extension.create({
  name: "editTracker",
  priority: 1000,
  addProseMirrorPlugins() {
    return [new Plugin<boolean>({ key, state: { init: () => false, apply: (tr) => tr.docChanged } })];
  },
});
