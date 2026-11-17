/**
 * How many of a line's items fit in `room`, keeping space for a "N more" marker after them while some are left out.
 * `widths` may cover only the first of `total` items: past a line's width the rest cannot fit anyway. The first item
 * always shows, cut short when it must be.
 */
export function fitting(widths: readonly number[], total: number, room: number, gap: number, marker: number) {
  let used = 0;
  for (const [index, width] of widths.entries()) {
    used += (index ? gap : 0) + width;
    const more = index < total - 1;
    if (used + (more ? gap + marker : 0) > room) return Math.max(1, index);
  }
  return widths.length;
}

/** One ResizeObserver for every element watched, so a table with a line in each cell keeps a single one. */
class Sizes {
  readonly #callbacks = new Map<Element, () => void>();
  #observer: ResizeObserver | null = null;

  watch(element: Element, callback: () => void) {
    this.#observer ??= new ResizeObserver((entries) => {
      for (const { target } of entries) this.#callbacks.get(target)?.();
    });
    this.#callbacks.set(element, callback);
    this.#observer.observe(element);
    return () => {
      this.#callbacks.delete(element);
      this.#observer?.unobserve(element);
    };
  }
}

export const sizes = new Sizes();
