import { type Leader, linkAt } from "@desk/editor";
import type { Editor } from "@tiptap/core";
import { palette } from "$lib/stores/palette.svelte";
import { sidebar } from "$lib/stores/sidebar.svelte";
import { pageIdOf } from "$model/urn";
import { openLinkMenu } from "./link-menu";
import { openRenameMenu } from "./rename-menu";

/** `space r`: the page mentioned under the cursor gets a new name, the link under it its editor. */
function rename(editor: Editor) {
  const { state } = editor;
  const pos = state.selection.head;
  const node = state.doc.nodeAt(pos);
  if (node?.type.name === "mention") {
    // A person is renamed in People, not here.
    const id = pageIdOf(String(node.attrs.id ?? ""));
    if (id) openRenameMenu(editor, pos, id);
  } else if (linkAt(state, pos)) openLinkMenu(editor);
}

/** `space e` / `space o` find a page, `space w` switches workspace, `space r` renames. */
export const LEADER: Leader = {
  e: () => palette.find(),
  o: () => palette.find(),
  w: () => sidebar.showSwitcher(),
  r: rename,
};
