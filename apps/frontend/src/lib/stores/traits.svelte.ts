import type { Schema } from "$model/properties";
import { traitAfter } from "$model/traits";
import { pageRecords } from "../sync/client.svelte";
import { local } from "../sync/local.svelte";
import { workspace } from "./workspace.svelte";

interface TraitPatch {
  readonly properties?: Schema;
  readonly renames?: Record<string, string>;
  readonly drop?: string[];
  /** Whether pages having the trait lose the dropped properties too. */
  readonly dropFromPages?: boolean;
}

/**
 * The open workspace's traits: its nodes of kind `trait`, from the synced records. A change to one's properties is the
 * synced `trait` action: drawn on the trait and every page having it at once, rewritten by the server, undoable.
 */
class Traits {
  /** With how many pages have each, which deleting one of its properties is asked about. */
  readonly list = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const page of pageRecords.all)
      if (page.workspaceId === workspace.id)
        for (const id of local.traitIds(page)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return local.traitsOf(workspace.id).map((trait) => ({ ...trait, pages: counts.get(trait.id) ?? 0 }));
  });

  get(id: string | undefined) {
    return this.list.find((t) => t.id === id);
  }

  update(id: string, { properties, renames, drop, dropFromPages }: TraitPatch) {
    const trait = local.page(id);
    if (!trait) return;
    const having = pageRecords.all.filter((p) => local.traitIds(p).includes(id)).map((p) => p.id);
    pageRecords.act("trait", id, {
      nodes: [id, ...having],
      properties: [...traitAfter(trait.schema, { properties, renames, drop })],
      ...(renames && { renames: { ...renames } }),
      ...(drop && { drop: [...drop] }),
      ...(dropFromPages && { dropFromPages }),
    });
  }
}

export const traits = new Traits();
