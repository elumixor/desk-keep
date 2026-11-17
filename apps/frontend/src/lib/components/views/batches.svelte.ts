/**
 * Rows drawn a batch at a time: the first at once, so a view shows the moment it is opened, the next whenever the
 * sentinel (`use:batch.sentinel`, under the rows) comes near sight.
 */
export function batches(total: () => number, first = 30, step = 60) {
  let limit = $state(first);
  return {
    get limit() {
      return limit;
    },
    get more() {
      return limit < total();
    },
    sentinel(node: HTMLElement) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          limit += step;
          // Observed afresh, so a sentinel still in sight after the batch asks for the next one.
          observer.unobserve(node);
          requestAnimationFrame(() => observer.observe(node));
        },
        // A view scrolling in a box of its own (`data-scroll-root`) loads ahead within it.
        { root: node.closest("[data-scroll-root]"), rootMargin: "600px" },
      );
      observer.observe(node);
      return { destroy: () => observer.disconnect() };
    },
  };
}
