/**
 * Things put in order by dragging a handle: the one held follows the pointer, the others slide aside to make room for
 * it (transforms, so nothing reflows while dragging), and the new order is handed over when it is let go.
 */
export class Sortable {
  /** The one held, its index and where it would land. */
  dragging = $state<string | null>(null);
  #from = $state(0);
  #to = $state(0);
  #delta = $state(0);
  /** Just dropped: the order changes under the transforms, so they snap back without sliding. */
  #settling = $state(false);
  #names: string[] = [];
  #sizes: number[] = [];

  constructor(
    private readonly axis: "x" | "y",
    /** The order taken: `name` before `before` (last when null). */
    private readonly commit: (name: string, before: string | null) => void,
  ) {}

  /**
   * Starts holding `name` of `names`, each as long along the axis as `sizes` says. With `threshold`, it is only held
   * once the pointer has moved that far, so a click on the same thing still clicks.
   */
  start(event: PointerEvent, name: string, names: readonly string[], sizes: readonly number[], threshold = 0) {
    if (event.button !== 0 || this.dragging) return;
    const from = names.indexOf(name);
    if (from < 0) return;
    if (!threshold) {
      event.preventDefault();
      event.stopPropagation();
    }
    const origin = this.axis === "x" ? event.clientX : event.clientY;
    const across = this.axis === "x" ? event.clientY : event.clientX;
    const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
    let held = false;
    const hold = () => {
      held = true;
      this.#names = [...names];
      this.#sizes = [...sizes];
      this.#from = this.#to = from;
      this.#delta = 0;
      this.dragging = name;
      getSelection()?.removeAllRanges();
    };
    if (!threshold) hold();
    const move = (e: PointerEvent) => {
      const delta = (this.axis === "x" ? e.clientX : e.clientY) - origin;
      if (!held) {
        if (Math.abs(delta) < threshold && Math.abs((this.axis === "x" ? e.clientY : e.clientX) - across) < threshold)
          return;
        hold();
      }
      e.preventDefault();
      this.#delta = delta;
      // Where its middle is now, against the others' middles as they stand.
      const middle = starts[from] + sizes[from] / 2 + delta;
      let to = 0;
      for (let i = 0; i < names.length; i++) if (i !== from && middle > starts[i] + sizes[i] / 2) to++;
      this.#to = to;
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (!held) return;
      // The click that ends a drag is not a click.
      const swallow = (e: MouseEvent) => e.stopPropagation();
      addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", swallow, true));
      const to = this.#to;
      this.#settling = true;
      this.dragging = null;
      if (to !== from) this.commit(name, names.filter((_, i) => i !== from)[to] ?? null);
      requestAnimationFrame(() => requestAnimationFrame(() => (this.#settling = false)));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  /** How far `name` stands from its place: the held one with the pointer, the ones it passed by its length. */
  shift(name: string): number {
    if (!this.dragging) return 0;
    if (name === this.dragging) return this.#delta;
    const i = this.#names.indexOf(name);
    const [from, to, size] = [this.#from, this.#to, this.#sizes[this.#from]];
    if (from < to && i > from && i <= to) return -size;
    if (to < from && i >= to && i < from) return size;
    return 0;
  }

  /** The style that places `name`: lifted while held, sliding while the others make room. */
  style(name: string): string {
    const shift = this.shift(name);
    const held = name === this.dragging;
    const move = this.axis === "x" ? `translateX(${shift}px)` : `translateY(${shift}px)`;
    const transition = held || this.#settling ? "none" : "transform 160ms cubic-bezier(0.2, 0, 0, 1)";
    return `transform: ${shift ? move : "none"}; transition: ${transition};${held ? " position: relative; z-index: 30;" : ""}`;
  }
}
