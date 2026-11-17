import { api } from "../api";
import { local } from "../sync/local.svelte";
import { notices } from "./notices.svelte";
import { store, stored, storedJson, storeJson } from "./stored";

const LAST_WORKSPACE = "keep.workspace";
const WORKSPACES = "keep.workspaces";

export type TreeRow = ReturnType<typeof local.tree>[number];
type WorkspaceItem = Awaited<ReturnType<typeof api.workspaces.$get>>[number];

export interface TreeNode {
  readonly row: TreeRow;
  readonly children: readonly TreeNode[];
  /** Under a trait or a view: its pages, folded into one row ("12 pages") instead of listed among its children. */
  readonly pages: readonly TreeNode[];
  /** A view and the trait it shows alone, one row: `row` is whichever was the parent. */
  readonly pair?: { readonly view: TreeRow; readonly trait: TreeRow };
}

/** The open workspace and the ones the person belongs to; its sidebar tree comes from the records on the device. */
class Workspace {
  id = $state<string | null>(null);
  /** Every workspace with the person's role in it, as last fetched (kept on the device for the first frame). */
  #fetched = $state<WorkspaceItem[]>(storedJson<WorkspaceItem[]>(WORKSPACES, []));
  /** The fetched list, named and drawn as the synced root pages are: a rename or a new icon shows at once. */
  readonly list = $derived(
    this.#fetched.map((w) => {
      const root = local.page(w.id);
      return root ? { ...w, title: root.title, icon: root.icon } : w;
    }),
  );

  readonly rows = $derived(this.id ? local.tree(this.id) : []);
  readonly roots = $derived.by(() => buildTree(this.rows, this.id));
  readonly current = $derived(this.list.find((w) => w.id === this.id));

  get loaded() {
    return local.ready;
  }

  open(id: string) {
    this.id = id;
    store(LAST_WORKSPACE, id);
  }

  async loadList() {
    try {
      this.#fetched = await api.workspaces.$get();
      storeJson(WORKSPACES, this.#fetched);
    } catch (error) {
      notices.error(error);
    }
    return this.list;
  }
}

/**
 * The tree of some nodes under `top` (a workspace, or the parent of a shared page): each node with its children, the
 * pages under a trait or view folded into it, and a view paired with the trait it shows alone.
 */
export function buildTree(rows: readonly TreeRow[], top: string | null): TreeNode[] {
  const byParent = new Map<string | null, TreeRow[]>();
  for (const row of rows) {
    const key = row.parentId === top ? null : row.parentId;
    byParent.set(key, [...(byParent.get(key) ?? []), row]);
  }
  const build = (parent: string | null): TreeNode[] =>
    (byParent.get(parent) ?? [])
      .toSorted((a, b) => a.sort - b.sort)
      .map((row) => {
        const all = build(row.id);
        // Under a trait or view every page folds into its count; under a page every child is listed.
        const folds = (c: TreeNode) => row.kind !== "page" && c.row.kind === "page";
        const node = { row, children: all.filter((c) => !folds(c)), pages: all.filter(folds) };
        // A view that shows only a trait, and that trait, one under the other: shown as one row.
        const shows = (view: TreeRow, trait: TreeRow) => local.showsAlone(view.id, trait.id);
        const at = node.children.findIndex((c) => shows(row, c.row) || shows(c.row, row));
        const child = node.children[at];
        if (!child) return node;
        return {
          row,
          children: [...node.children.toSpliced(at, 1), ...child.children],
          pages: [...node.pages, ...child.pages],
          pair: row.kind === "view" ? { view: row, trait: child.row } : { view: child.row, trait: row },
        };
      });
  return build(null);
}

/** A shared page's node, with what is under it, from the records of its workspace on the device. */
export function sharedTree(pageId: string): TreeNode | null {
  const root = local.page(pageId);
  if (!root?.workspaceId) return null;
  return buildTree(local.tree(root.workspaceId), root.parentId).find((n) => n.row.id === pageId) ?? null;
}

export const workspace = new Workspace();
/** The workspace this device opened last. */
export const lastWorkspace = () => stored(LAST_WORKSPACE);
