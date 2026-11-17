/**
 * Moves an element to the body: an ancestor with layout containment (a container query's box) would anchor its
 * `position: fixed` to itself instead of the window.
 */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}

/** Moves an element into `target`, once there is one: a page's menu into the bar of the peek showing it. */
export function moveTo(node: HTMLElement, target: HTMLElement | undefined) {
  target?.append(node);
  return {
    update: (next: HTMLElement | undefined) => next?.append(node),
    destroy: () => node.remove(),
  };
}
