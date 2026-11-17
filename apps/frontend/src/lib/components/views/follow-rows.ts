const DURATION_MS = 200;
/** `cubicOut`, as the rows' `flip` moves. */
const EASING = "cubic-bezier(0.33, 1, 0.68, 1)";

/**
 * For what stands under a view's rows but outside their keyed `each` ("New"), where `animate:flip` cannot reach: when
 * the number of rows changes it glides to its new place with them, faded so it does not flash over the row taking its
 * place. Its parameter is how many rows are drawn.
 */
export function followRows(node: HTMLElement, count: number) {
  let top = node.offsetTop;
  let last = count;

  const move = () => {
    const next = node.offsetTop;
    // From where it shows now, so a move on top of another one does not jump.
    const shifted = new DOMMatrix(getComputedStyle(node).transform).m42;
    const from = top + shifted - next;
    top = next;
    if (!from) return;
    for (const animation of node.getAnimations()) animation.cancel();
    node.animate(
      [
        { transform: `translateY(${from}px)`, opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
  };

  return {
    update(next: number) {
      if (next === last) return;
      last = next;
      // After the rows' `each` has changed the page.
      queueMicrotask(move);
    },
  };
}
