import type { TraitRecord } from "$model/sync";

type Trait = TraitRecord & { readonly pages: number };

/**
 * A change to a property some traits have, waiting for the person to say where it is made (`TraitChange.svelte`):
 * - `rename`, `retype`, `delete` of a page's property: on one of its traits (every page having it follows) or on
 *   this page alone (which then no longer has those traits);
 * - `drop` of a trait's property: its pages keep it (`here`), or lose it too (`onTrait`).
 */
interface PendingChange {
  readonly what: "rename" | "retype" | "delete" | "drop";
  readonly property: string;
  /** The new name or type. */
  readonly to: string;
  readonly traits: readonly Trait[];
  readonly here: () => void;
  readonly onTrait: (trait: Trait) => void;
}

class TraitChanges {
  pending = $state<PendingChange | null>(null);

  ask(change: PendingChange) {
    this.pending = change;
  }

  close() {
    this.pending = null;
  }
}

export const traitChanges = new TraitChanges();
