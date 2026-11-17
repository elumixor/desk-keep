import { type DocNode, extractLinks } from "$model/document";
import type { PropertyValues } from "$model/properties";
import { asTrait, type CommentRecord, type PageRecord, type ReactionRecord, type TraitRecord } from "$model/sync";
import { inferTraits, traitsOf } from "$model/traits";
import { pageUrn } from "$model/urn";
import { archivedMode, type ScopedPage, selectsNothing, TEMPLATE_TITLE, underFilters, viewResult } from "$model/views";
import { formulas } from "../scripts/formula.svelte";
import { commentRecords, pageRecords, reactionRecords, viewRecords } from "./client.svelte";

/**
 * What the screens show, worked out on the device from the synced records: the sidebar tree, a node with its
 * ancestors, children, backlinks and comments, which traits each page has, and what each view selects. The server
 * computes the same things the same way (`$model`) for assistants; here they follow every edit the moment it is made.
 */

const byOrder = (a: PageRecord, b: PageRecord) => a.sort - b.sort;

/** What a page's body and relation values point at, kept per record: a record is replaced, never changed. */
const linksOf = new WeakMap<PageRecord, { urn: string; kind: string }[]>();

function outgoing(page: PageRecord) {
  let links = linksOf.get(page);
  if (!links) {
    const relations = page.schema
      .filter((p) => p.type === "relation")
      .flatMap((p) =>
        ((page.properties[p.name] as string[] | undefined) ?? []).map((id) => ({ urn: pageUrn(id), kind: "property" })),
      );
    links = [...(page.body ? extractLinks(page.body as DocNode) : []), ...relations];
    linksOf.set(page, links);
  }
  return links;
}

class Local {
  readonly pages = $derived(new Map(pageRecords.all.map((p) => [p.id, p])));

  readonly children = $derived.by(() => {
    const out = new Map<string, PageRecord[]>();
    for (const page of pageRecords.all) {
      if (!page.parentId) continue;
      const list = out.get(page.parentId);
      if (list) list.push(page);
      else out.set(page.parentId, [page]);
    }
    for (const list of out.values()) list.sort(byOrder);
    return out;
  });

  /** Every workspace's traits, by name. */
  readonly traits = $derived(
    pageRecords.all
      .filter((p) => p.kind === "trait")
      .map(asTrait)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  /**
   * Which traits each page has, worked out here as the server does: a property renamed on the device takes the page
   * out of a trait at once, not after the next sync.
   */
  readonly #inferred = $derived.by(() => {
    const traits = this.traits;
    const cache = new WeakMap<PageRecord, string[]>();
    return (page: PageRecord) => {
      if (page.kind !== "page") return [];
      let found = cache.get(page);
      if (!found) {
        found = inferTraits(
          page.schema,
          traits.filter((t) => t.workspaceId === page.workspaceId),
        );
        cache.set(page, found);
      }
      return found;
    };
  });

  /** Each page's comments, oldest first (the order the records keep). */
  readonly comments = $derived.by(() => {
    const out = new Map<string, CommentRecord[]>();
    for (const comment of commentRecords.all) out.set(comment.pageId, [...(out.get(comment.pageId) ?? []), comment]);
    return out;
  });

  /** Each comment's reactions, oldest first, by emoji. */
  readonly reactions = $derived.by(() => {
    const out = new Map<string, Map<string, ReactionRecord[]>>();
    for (const reaction of reactionRecords.all) {
      const byEmoji = out.get(reaction.commentId) ?? new Map<string, ReactionRecord[]>();
      byEmoji.set(reaction.emoji, [...(byEmoji.get(reaction.emoji) ?? []), reaction]);
      out.set(reaction.commentId, byEmoji);
    }
    return out;
  });

  get ready() {
    return pageRecords.ready;
  }

  page(id: string) {
    return this.pages.get(id);
  }

  childrenOf(id: string) {
    return this.children.get(id) ?? [];
  }

  commentsOf(id: string) {
    return this.comments.get(id) ?? [];
  }

  comment(id: string) {
    return commentRecords.get(id);
  }

  /** A comment's reactions: each emoji with who put it there, in the order first put. */
  reactionsOf(commentId: string): ReadonlyMap<string, readonly ReactionRecord[]> {
    return this.reactions.get(commentId) ?? new Map();
  }

  /** A view's query, while its node is alive. */
  view(id: string) {
    if (this.pages.get(id)?.kind !== "view") return undefined;
    return viewRecords.all.find((v) => v.id === id);
  }

  /** Whether a view shows that trait alone. */
  showsAlone(viewId: string, traitId: string) {
    const traits = this.view(viewId)?.traits;
    return this.pages.get(traitId)?.kind === "trait" && traits?.length === 1 && traits[0] === traitId;
  }

  /** The view or trait a node pairs with: one right under the other, the view showing that trait alone. */
  partnerOf(id: string) {
    const node = this.pages.get(id);
    if (node?.kind !== "view" && node?.kind !== "trait") return undefined;
    const pairs = (other: { id: string }) => this.showsAlone(id, other.id) || this.showsAlone(other.id, id);
    const parent = node.parentId ? this.pages.get(node.parentId) : undefined;
    if (parent && pairs(parent)) return parent;
    return this.childrenOf(id).find(pairs);
  }

  traitsOf(workspaceId: string | null | undefined): TraitRecord[] {
    return this.traits.filter((t) => t.workspaceId === workspaceId);
  }

  trait(id: string | undefined) {
    return this.traits.find((t) => t.id === id);
  }

  /** The ids of the traits a page has. */
  traitIds(page: PageRecord) {
    return this.#inferred(page);
  }

  /** The pages above one, the workspace first. */
  ancestors(page: PageRecord) {
    const out: PageRecord[] = [];
    let parent = page.parentId ? this.pages.get(page.parentId) : undefined;
    while (parent && out.length < 64) {
      out.unshift(parent);
      parent = parent.parentId ? this.pages.get(parent.parentId) : undefined;
    }
    return out;
  }

  backlinks(id: string) {
    const urn = pageUrn(id);
    const out: { id: string; title: string; icon: string | null; kind: string }[] = [];
    for (const page of pageRecords.all) {
      const seen = new Set<string>();
      for (const link of outgoing(page))
        if (link.urn === urn && !seen.has(link.kind)) {
          seen.add(link.kind);
          out.push({ id: page.id, title: page.title, icon: page.icon, kind: link.kind });
        }
    }
    return out;
  }

  /** The workspace's nodes for the sidebar: archived ones are out of it, and with them what is under them. */
  tree(workspaceId: string) {
    return pageRecords.all
      .filter((p) => p.workspaceId === workspaceId && p.id !== workspaceId && !p.archivedAt)
      .map((p) => ({ id: p.id, parentId: p.parentId, kind: p.kind, title: p.title, icon: p.icon, sort: p.sort }));
  }

  /** A view's child pages, and how many of them it shows: what the tree says after its title. */
  pageCount(id: string, folded: number): { shown: number; total: number } | null {
    if (this.pages.get(id)?.kind !== "view" || !folded) return null;
    return { shown: folded - this.hiddenChildren(id), total: folded };
  }

  /** How many pages have all of these traits, worked out off the frame that asked. */
  countHaving(workspaceId: string, traits: readonly string[]): Promise<number> {
    return new Promise((resolve) =>
      setTimeout(() =>
        resolve(
          pageRecords.all.filter((p) => {
            if (p.kind !== "page" || p.workspaceId !== workspaceId) return false;
            const has = this.traitIds(p);
            return traits.every((t) => has.includes(t));
          }).length,
        ),
      ),
    );
  }

  /** Of a trait's or view's child pages, how many it does not show: the ones lacking its traits or kept out. */
  hiddenChildren(id: string) {
    const node = this.pages.get(id);
    const pages = this.childrenOf(id).filter((c) => c.kind === "page" && !c.archivedAt);
    if (node?.kind === "page") return 0;
    // A trait's template is its own page, not one missing it.
    if (node?.kind === "trait")
      return pages.filter((p) => p.title !== TEMPLATE_TITLE && !this.traitIds(p).includes(id)).length;
    if (node?.kind !== "view") return 0;
    const shown = new Set(this.viewResult(id)?.rows.map((r) => r.id) ?? []);
    return pages.filter((p) => !shown.has(p.id)).length;
  }

  /** A node as its screen shows it. */
  pageData(id: string, canEdit: boolean) {
    const page = this.pages.get(id);
    if (!page) return undefined;
    const traits = this.traitsOf(page.workspaceId);
    return {
      page: {
        ...page,
        /** The traits the page has. */
        traits: traitsOf(this.traitIds(page), traits).map(({ id, name, icon }) => ({ id, name, icon })),
      },
      ancestors: this.ancestors(page).map(({ id, title, icon }) => ({ id, title, icon })),
      children: this.childrenOf(id),
      backlinks: this.backlinks(id),
      canEdit,
    };
  }

  /** Every page under one, at any depth. */
  #subtree(id: string, into = new Set<string>()) {
    for (const child of this.childrenOf(id)) {
      into.add(child.id);
      this.#subtree(child.id, into);
    }
    return into;
  }

  /**
   * What a query shows, as the server would answer it (`$model/views`): pages having all of its traits, filtered,
   * archived ones only when it shows them.
   */
  query(workspaceId: string, query: Parameters<typeof viewResult>[2]) {
    const under = underFilters(query).map((id) => this.#subtree(id));
    const archived = archivedMode(query);
    const found = pageRecords.all
      .filter((page) => {
        if (page.kind !== "page" || page.workspaceId !== workspaceId || !page.parentId) return false;
        if (archived === "exclude" ? page.archivedAt : archived === "only" && !page.archivedAt) return false;
        const has = this.traitIds(page);
        return query.traits.every((t) => has.includes(t)) && under.every((ids) => ids.has(page.id));
      })
      .map(
        (page): ScopedPage => ({
          ...page,
          traits: this.traitIds(page),
          properties: page.properties as PropertyValues,
          createdAt: page.createdAt ?? "",
          updatedAt: page.updatedAt ?? "",
        }),
      );
    const code = query.sortCode?.trim();
    const sortKey = code
      ? (page: ScopedPage) => formulas.sortKey(this.pages.get(page.id) as PageRecord, code)
      : undefined;
    return viewResult(found, this.traitsOf(workspaceId), query, sortKey);
  }

  /** What a view shows. */
  viewResult(viewId: string) {
    const view = this.view(viewId);
    const node = this.pages.get(viewId);
    if (!view || !node?.workspaceId) return undefined;
    if (selectsNothing(view)) return { view, ...viewResult([], [], view) };
    return { view, ...this.query(node.workspaceId, view) };
  }
}

export const local = new Local();
