import { movePage, movePages } from "$lib/actions";
import { unlessMany } from "$lib/bulk";
import { tree } from "$lib/stores/tree.svelte";
import { synced, viewRecords } from "$lib/sync/client.svelte";
import { local } from "$lib/sync/local.svelte";

/** What the drag in the tree carries besides the dragged row's id. */
export const drag = {
  /** One half of a merged view and trait, by its icon: it leaves the other half where it is. */
  alone: false,
  /** Set while the "N pages" count is dragged: the drag moves just those pages, not the view or trait they are under. */
  folded: null as string[] | null,
};

/** A trait dropped onto a view, or a view onto a trait: the view shows that trait too. */
function link(id: string, onto: string) {
  const [viewId, traitId] = local.page(id)?.kind === "trait" ? [onto, id] : [id, onto];
  const view = local.view(viewId);
  if (!view || local.page(traitId)?.kind !== "trait" || view.traits.includes(traitId)) return;
  viewRecords.update(viewId, { traits: [...view.traits, traitId] });
}

/**
 * Moves the dragged row `id` (or the selection it is in, or the folded pages it carries) under `parentId`, before
 * `beforeId`; `into`: dropped onto `parentId`'s row, so a trait and a view link up.
 */
export async function drop(id: string, parentId: string, beforeId: string | null, into = false) {
  const only = drag.folded;
  const single = drag.alone;
  drag.folded = null;
  drag.alone = false;
  const ids = only ?? (tree.selected.has(id) ? [...tree.selected] : null);
  if (ids) {
    unlessMany(
      ids,
      (count) => `Move ${count} pages into “${local.page(parentId)?.title || "Untitled"}”?`,
      "Move",
      () => {
        if (!only) tree.clearSelection();
        movePages(ids, parentId, beforeId);
      },
    );
    return;
  }
  // A merged pair carried whole keeps the trait its view shows.
  const pairs = !single && !!local.partnerOf(id);
  synced.transaction(() => {
    if (into && !pairs) link(id, parentId);
    movePage(id, parentId, beforeId, single);
  });
}
