import type { Editor } from "@tiptap/core";
import { renamePage } from "$lib/actions";
import { local } from "$lib/sync/local.svelte";
import { caretPopup } from "./caret-popup";
import RenameMenu from "./RenameMenu.svelte";

/** The menu `space r` opens on a mentioned page: Enter renames the page itself, so every mention of it follows. */
export function openRenameMenu(editor: Editor, pos: number, id: string) {
  const page = local.page(id);
  if (!page) return;
  caretPopup(
    editor,
    pos,
    RenameMenu,
    (close) => ({
      initial: page.title,
      kind: page.kind,
      onapply: (title: string) => {
        renamePage(id, title);
        close(true);
      },
    }),
    () => pos,
  );
}
