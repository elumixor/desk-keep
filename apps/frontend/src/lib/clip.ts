import { sizes } from "./one-line";

/**
 * Text on one line that is cut only when its room is too short, the cut a single "…" inside the underline (CSS's own
 * ellipsis is left out of it). The node sizes by the full text, shrinking with its room; the cut copy is drawn over it.
 */
export function clipToFit(node: HTMLElement, text: string) {
  const full = document.createElement("span");
  const cut = document.createElement("span");
  cut.className = "absolute top-0 left-0 whitespace-nowrap";
  cut.style.textDecoration = "underline";
  cut.style.textDecorationColor = "var(--ink-20)";
  cut.style.textUnderlineOffset = "3px";
  node.append(full, cut);
  let current = text;

  const fit = () => {
    full.textContent = current;
    const room = node.clientWidth;
    // Measured while laid out, hidden by visibility only: a copy out of the layout would read as fitting anything.
    cut.textContent = current;
    if (!room || cut.scrollWidth <= room) {
      cut.style.visibility = "hidden";
      full.style.visibility = "";
      return;
    }
    let [low, high] = [0, current.length];
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      cut.textContent = `${current.slice(0, mid).trimEnd()}…`;
      if (cut.scrollWidth <= room) low = mid;
      else high = mid - 1;
    }
    cut.textContent = `${current.slice(0, low).trimEnd()}…`;
    cut.style.visibility = "";
    full.style.visibility = "hidden";
  };

  fit();
  const stop = sizes.watch(node, fit);
  return {
    update(next: string) {
      current = next;
      fit();
    },
    destroy: stop,
  };
}
