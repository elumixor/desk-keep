import { inside, movePage } from "$lib/actions";
import { local } from "$lib/sync/local.svelte";
import { subtasks } from "./subtasks.svelte";

/** Where a dragged row lands against the row under the pointer: above it, below it, or as its child. */
export type Drop = { readonly id: string; readonly where: "before" | "after" | "inside" };

/**
 * View rows dragged by a handle to another place in the tree: the upper or lower quarter of a row puts the page next
 * to it (under the same parent), the middle puts it under that row. Rows carry their page's id as `data-row`.
 */
export class RowDrag {
  /** The row held, once the pointer has moved enough to make it a drag. */
  held = $state<string | null>(null);
  /** Where it would land now; none over itself or its own children. */
  over = $state<Drop | null>(null);

  constructor(private readonly viewId: () => string) {}

  start(event: PointerEvent, id: string, threshold = 4) {
    // Its buttons (the chevron, Open, add) keep their clicks.
    if (event.button !== 0 || this.held || (event.target as Element).closest("button:not([data-drags])")) return;
    const origin = { x: event.clientX, y: event.clientY };
    const move = (e: PointerEvent) => {
      if (!this.held) {
        if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < threshold) return;
        this.held = id;
        // A title being typed into stops being edited: the row is being moved instead.
        (document.activeElement as HTMLElement | null)?.blur();
        getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-row]");
      const target = row?.dataset.row;
      if (!row || !target || inside(target, id)) {
        this.over = null;
        return;
      }
      const box = row.getBoundingClientRect();
      const at = (e.clientY - box.top) / box.height;
      this.over = { id: target, where: at < 0.25 ? "before" : at > 0.75 ? "after" : "inside" };
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (!this.held) return;
      // The click that ends a drag is not a click.
      const swallow = (e: MouseEvent) => e.stopPropagation();
      addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", swallow, true));
      const drop = this.over;
      this.held = this.over = null;
      if (drop) this.drop(id, drop);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  private drop(id: string, { id: target, where }: Drop) {
    if (where === "inside") {
      subtasks.open(this.viewId(), target);
      return movePage(id, target, null);
    }
    const parent = local.page(target)?.parentId;
    if (!parent) return;
    const siblings = local.childrenOf(parent).filter((s) => s.id !== id);
    const before = where === "before" ? target : (siblings[siblings.findIndex((s) => s.id === target) + 1]?.id ?? null);
    movePage(id, parent, before);
  }

  /** How a row shows where the held one would land: a line above or below it, or a wash when it would go inside. */
  mark(id: string) {
    if (this.held === id) return "opacity-40";
    if (this.over?.id !== id) return "";
    return this.over.where === "inside"
      ? "bg-accent-soft!"
      : this.over.where === "before"
        ? "shadow-[inset_0_2px_0_var(--accent)]"
        : "shadow-[inset_0_-2px_0_var(--accent)]";
  }
}
