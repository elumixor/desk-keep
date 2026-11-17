import { Archive, ArchiveRestore, Link, PanelRightOpen, PanelTop, SquareArrowOutUpRight, Trash2 } from "lucide-svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { pageUrl } from "$model/urn";
import { deletePage, inside, pageHref } from "./actions";
import { access } from "./stores/access.svelte";
import type { MenuEntries } from "./stores/context-menu.svelte";
import { notices } from "./stores/notices.svelte";
import { workspace } from "./stores/workspace.svelte";
import { pageRecords } from "./sync/client.svelte";
import { local } from "./sync/local.svelte";

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    notices.show(`${what} copied`);
  } catch (error) {
    notices.error(error);
  }
}

/** The page's address, which opens it from anywhere (other apps too). */
export const copyPageLink = (id: string) => copyText(pageUrl(id), "Link");

/**
 * Archives a page (out of the tree and views, kept and found by search) or brings it back: drawn at once, synced
 * behind; the server stamps the time it keeps.
 */
export function setArchived(id: string, archived: boolean) {
  pageRecords.update(id, { archivedAt: archived ? new Date().toISOString() : null });
  notices.show(archived ? "Archived" : "Restored from the archive");
}

/** Trashes a page, leaving it for its parent when it is open or holds the open page. */
export async function trashPage(id: string) {
  const parent = local.page(id)?.parentId;
  const open = page.params.page;
  const leaving = !!open && inside(open, id);
  deletePage(id);
  if (leaving) await goto(parent ? pageHref(parent) : "/");
}

/**
 * What a right click on a page offers wherever it shows: a link, a mention, a view's row (which `peek`s at it beside
 * the view); `more` goes before trashing.
 */
export function pageEntries(
  id: string,
  { open = true, peek, more = [] }: { open?: boolean; peek?: () => void; more?: MenuEntries } = {},
): MenuEntries {
  const record = local.page(id);
  const known = !!record;
  return [
    peek && { label: "Open beside", icon: PanelRightOpen, run: peek },
    open && { label: "Open", icon: PanelTop, run: () => void goto(pageHref(id)) },
    { label: "Open in new tab", icon: SquareArrowOutUpRight, run: () => void window.open(pageHref(id), "_blank") },
    "separator",
    { label: "Copy link", icon: Link, run: () => void copyPageLink(id) },
    "separator",
    ...more,
    "separator",
    record?.kind === "page" &&
      access.can(id, "write") &&
      id !== workspace.id &&
      (record.archivedAt
        ? { label: "Restore from archive", icon: ArchiveRestore, run: () => setArchived(id, false) }
        : { label: "Archive", icon: Archive, run: () => setArchived(id, true) }),
    known &&
      access.can(id, "delete") &&
      id !== workspace.id && { label: "Move to trash", icon: Trash2, danger: true, run: () => void trashPage(id) },
  ];
}
