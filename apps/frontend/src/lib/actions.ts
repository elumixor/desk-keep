import { Trash2 } from "lucide-svelte";
import { goto } from "$app/navigation";
import type { Manifest } from "$model/extensions";
import type { NodeKind } from "$model/nodes";
import { findProperty } from "$model/properties";
import type { PageRecord, ViewRecord } from "$model/sync";
import { sortBefore, sortsBefore } from "$model/tree";
import { api } from "./api";
import type { ScriptRun } from "./scripts/run";
import { extensions } from "./stores/extensions.svelte";
import { fresh } from "./stores/fresh";
import { notices } from "./stores/notices.svelte";
import { pages, trashedRecords } from "./stores/pages.svelte";
import { workspace } from "./stores/workspace.svelte";
import { pageRecords, synced, viewRecords } from "./sync/client.svelte";
import { local } from "./sync/local.svelte";
import { capitalized } from "./text";

/** A title nothing else under the parent has: the one wanted, else numbered ("Task (2)"), as the server keeps it. */
export function freeTitle(parentId: string, title: string, except?: string) {
  const taken = (t: string) =>
    !!t.trim() && local.childrenOf(parentId).some((c) => c.id !== except && c.title.toLowerCase() === t.toLowerCase());
  if (!taken(title)) return title;
  let n = 2;
  while (taken(`${title} (${n})`)) n++;
  return `${title} (${n})`;
}

const DEFAULT_TITLES: Record<NodeKind, string> = { page: "", trait: "New trait", view: "Table" };

/** A blank page record under `parentId`, after its last child, with `fields` on top. */
export function newPageRecord(parentId: string, fields: Partial<PageRecord> = {}) {
  const now = new Date().toISOString();
  return {
    parentId,
    workspaceId: local.page(parentId)?.workspaceId ?? workspace.id,
    kind: "page" as NodeKind,
    title: "",
    icon: null,
    description: "",
    body: null,
    properties: {},
    schema: [],
    traits: [],
    sort: (local.childrenOf(parentId).at(-1)?.sort ?? 0) + 1,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

/**
 * What the sidebar, the palette and the pages all do to the tree, in one place: drawn at once, synced behind. A node
 * is a page, a trait or a view (a table of every page, until it is told which traits to show).
 */
export async function createPage(
  parentId: string,
  options: { kind?: NodeKind; open?: boolean; title?: string; icon?: string | null; view?: Partial<ViewRecord> } = {},
) {
  const id = crypto.randomUUID();
  const kind = options.kind ?? "page";
  synced.transaction(() => {
    pageRecords.create({
      id,
      ...newPageRecord(parentId, {
        kind,
        title: freeTitle(parentId, options.title ?? DEFAULT_TITLES[kind]),
        icon: options.icon ?? null,
      }),
    });
    if (kind === "view")
      viewRecords.create({
        id,
        kind: "table",
        traits: [],
        filter: [],
        sort: [],
        groupBy: null,
        visibleProperties: null,
        barProperties: null,
        sortCode: null,
        newParent: null,
        showArchived: false,
        cleanup: null,
        ...options.view,
      });
  });
  if (options.open !== false) {
    fresh.id = id;
    await goto(`/w/${workspace.id}/p/${id}`);
  }
  return { id };
}

/** A trait and a table of the pages having it, side by side under `parentId`; opens the trait to give it properties. */
export async function createTraitWithView(parentId: string, title = DEFAULT_TITLES.trait) {
  const trait = await createPage(parentId, { kind: "trait", title, open: false });
  await createPage(parentId, {
    kind: "view",
    title: `${local.page(trait.id)?.title ?? title} table`,
    open: false,
    view: { traits: [trait.id] },
  });
  await goto(`/w/${workspace.id}/p/${trait.id}`);
  return trait;
}

/** Whether a page is `ancestorId` or under it. */
export const inside = (id: string, ancestorId: string) => {
  for (let at: string | null | undefined = id; at; at = local.page(at)?.parentId) if (at === ancestorId) return true;
  return false;
};

/** The pages without those inside another of them: moving or deleting a page takes its subtree along. */
export function topmost(ids: Iterable<string>) {
  const all = new Set(ids);
  return [...all].filter((id) => {
    for (let at = local.page(id)?.parentId; at; at = local.page(at)?.parentId) if (all.has(at)) return false;
    return true;
  });
}

/** Every page under these, for keeping them out of a "move into" list. */
export function subtreeIds(ids: Iterable<string>): Set<string> {
  const found = new Set<string>();
  const walk = (id: string) => {
    found.add(id);
    for (const child of local.childrenOf(id)) walk(child.id);
  };
  for (const id of ids) walk(id);
  return found;
}

/** Moves the pages, in this order, under `parentId` (before `beforeId`, else last); never into themselves. */
/**
 * Moves pages under `parentId`, in their order, before `beforeId` (last when null): one page as `movePage` does, many
 * as one write, so a hundred pages are one request for the server and one step to undo.
 */
export function movePages(ids: Iterable<string>, parentId: string, beforeId: string | null = null) {
  const moving = topmost(ids).filter((id) => id !== beforeId && !inside(parentId, id));
  if (moving.length <= 1) {
    for (const id of moving) movePage(id, parentId, beforeId);
    return;
  }
  const siblings = local.childrenOf(parentId).filter((s) => !moving.includes(s.id));
  const sorts = sortsBefore(siblings, beforeId, moving.length);
  const moves = Object.fromEntries(moving.map((id, i) => [id, { parentId, sort: sorts[i] }]));
  pageRecords.act("move", moving[0], { moves });
}

/** `alone`: a view or trait leaves its partner under it behind, in its place, rather than carrying it along. */
export function movePage(id: string, parentId: string, beforeId: string | null, alone = false) {
  const moved = local.page(id);
  const partner = alone ? local.partnerOf(id) : undefined;
  if (moved && partner?.parentId === id && partner.id !== parentId)
    pageRecords.update(partner.id, { parentId: moved.parentId, sort: moved.sort });
  const target = local.page(parentId);
  const traits = local.view(id)?.traits;
  // A view dropped into the trait it shows alone becomes its parent, in its place, and the trait takes its name and icon.
  if (moved?.kind === "view" && target?.kind === "trait" && traits?.length === 1 && traits[0] === parentId) {
    const siblings = local.childrenOf(target.parentId ?? "").filter((s) => s.id !== id);
    synced.transaction(() => {
      pageRecords.update(id, { parentId: target.parentId, sort: sortBefore(siblings, parentId) });
      pageRecords.update(parentId, { parentId: id, sort: 0, title: moved.title, icon: moved.icon });
    });
    return;
  }
  const siblings = local.childrenOf(parentId).filter((s) => s.id !== id);
  // A trait dropped into the view that shows it alone takes the view's name and icon.
  const pairs = moved?.kind === "trait" && target && local.showsAlone(parentId, id);
  pageRecords.update(id, {
    parentId,
    sort: sortBefore(siblings, beforeId),
    ...(pairs && { title: target.title, icon: target.icon }),
  });
}

/** Renames a page from the tree: one undo step (⌘Z). */
export function renamePage(id: string, title: string) {
  const old = local.page(id)?.title;
  if (old === undefined || old === title) return;
  pages.edit(id, { title });
}

/** Trashes the pages and their subtrees with one notice that restores them all. */
export function deletePages(ids: Iterable<string>) {
  const roots = topmost(ids);
  for (const id of roots) deletePage(id, false);
  notices.show(roots.length === 1 ? "Moved to trash" : `Moved ${roots.length} pages to trash`, {
    icon: Trash2,
    action: { label: "Restore", run: () => void Promise.all(roots.map(restorePage)) },
  });
}

export function deletePage(id: string, notify = true) {
  const record = local.page(id);
  if (record) trashedRecords.set(id, record);
  pageRecords.delete(id);
  if (notify)
    notices.show("Moved to trash", { icon: Trash2, action: { label: "Restore", run: () => void restorePage(id) } });
}

export async function restorePage(id: string) {
  const record = trashedRecords.get(id);
  if (record) {
    // The server restores a page created again under its id, with its subtree.
    trashedRecords.delete(id);
    pageRecords.create(record);
    return;
  }
  try {
    await api.pages(id).restore.$post();
    await synced.sync();
  } catch (error) {
    notices.error(error);
  }
}

/** Deletes a page in the trash for good, with everything under it; resolves with whether it went. */
export async function purgePage(id: string) {
  try {
    await api.pages(id).permanent.$delete();
    trashedRecords.delete(id);
    notices.show("Deleted permanently", { icon: Trash2 });
    return true;
  } catch (error) {
    notices.error(error);
    return false;
  }
}

/** Whether a page has nothing in it: no title, text, properties or subpages. */
export function isBlank(id: string) {
  const record = local.page(id);
  if (!record || record.kind !== "page" || record.title.trim() || Object.keys(record.properties).length) return false;
  if (local.childrenOf(id).length) return false;
  const text = (node: unknown): boolean => {
    const n = node as { text?: string; type?: string; content?: unknown[] } | null;
    if (!n) return false;
    if (n.text?.trim()) return true;
    if (n.type && !["doc", "paragraph"].includes(n.type)) return true;
    return !!n.content?.some(text);
  };
  return !text(record.body);
}

/** Closes the open page: goes up to its parent, and trashes the page first when it is blank. */
export async function closePage(id: string) {
  const parentId = local.page(id)?.parentId;
  const blank = isBlank(id);
  await goto(parentId ? pageHref(parentId) : `/w/${workspace.id}`);
  if (blank) deletePage(id);
}

/** Where a page opens: under its own workspace (a page shared from another one opens there), the open one otherwise. */
export function pageHref(id: string) {
  const workspaceId = local.page(id)?.workspaceId ?? workspace.id;
  return id === workspaceId ? `/w/${workspaceId}` : `/w/${workspaceId}/p/${id}`;
}

/**
 * Presses a page's button: its script (or `code`, run in its place from the editor) runs here in the browser, on the
 * pages as synced, so what it writes shows at once and syncs behind; a question it asks is put to the presser as it
 * comes. What it said shows as notices (what it threw as an error) and the URLs it opened open in new tabs. Null when
 * it could not run.
 */
export async function pressButton(pageId: string, property: string, code?: string): Promise<ScriptRun | null> {
  try {
    const page = local.page(pageId);
    const definition = page && findProperty(page.schema, property);
    if (!page || (code === undefined && definition?.type !== "button")) throw new Error(`No button "${property}"`);
    const workspaceId = page.workspaceId ?? page.id;
    const source = { label: property, pageId };
    const [{ runScript }] = await Promise.all([import("./scripts/run"), extensions.load(workspaceId)]);
    const scriptExtensions = extensions.list.map((e) => ({ id: e.id, name: e.name, manifest: e.manifest as Manifest }));
    const answer = await runScript(page, code ?? definition?.code ?? "", source, scriptExtensions);
    for (const message of answer.messages) notices.show(capitalized(message), { source });
    if (answer.error) notices.show(answer.error, { tone: "error", source });
    // What it logged shows in this browser's console too, where a developer looks.
    for (const line of answer.logs) console.log(`[${property}]`, line);
    if (answer.error) console.error(`[${property}]`, answer.error);
    for (const url of answer.open) window.open(url, "_blank", "noopener");
    return answer;
  } catch (error) {
    notices.error(error);
    return null;
  }
}
