import { goto } from "$app/navigation";
import { page } from "$app/state";
import { deletePages, inside, movePages, pageHref, subtreeIds, topmost } from "./actions";
import { confirm } from "./stores/confirm.svelte";
import { palette } from "./stores/palette.svelte";
import { tree } from "./stores/tree.svelte";
import { workspace } from "./stores/workspace.svelte";
import { local } from "./sync/local.svelte";

/** From this many pages, counting the ones inside, a bulk move or trash asks first. */
const MANY = 10;

/** Runs `run` straight away for a few pages, after a yes for many. */
export function unlessMany(
  ids: string[],
  text: (count: number) => string,
  action: string,
  run: () => void,
  danger = false,
) {
  const count = subtreeIds(topmost(ids)).size;
  if (count < MANY) run();
  else confirm.show(text(count), action, run, danger);
}

/** Asks where to, then moves the pages picked in the tree there. */
export function moveSelected() {
  const ids = topmost(tree.selected);
  palette.pick(`Move ${ids.length} pages into…`, subtreeIds(ids), (parentId) => {
    palette.hide();
    const into = local.page(parentId)?.title || "Untitled";
    unlessMany(
      ids,
      (count) => `Move ${count} pages into “${into}”?`,
      "Move",
      () => {
        tree.set(parentId, true);
        movePages(ids, parentId);
        tree.clearSelection();
      },
    );
  });
}

/** Trashes the pages picked in the tree, leaving the open page if it was one of them or inside one. */
export function trashSelected() {
  const ids = [...tree.selected];
  unlessMany(
    ids,
    (count) => `Move ${count} pages to trash?`,
    "Move to trash",
    () => {
      tree.clearSelection();
      deletePages(ids);
      const open = page.params.page;
      if (open && ids.some((id) => inside(open, id))) void goto(workspace.id ? pageHref(workspace.id) : "/");
    },
    true,
  );
}
