const MIN_WIDTH = 80;

/** A view's column widths, dragged by a handle and remembered on this device. */
export function columnWidths(key: () => string, fallback = 180) {
  let widths = $state<Record<string, number>>({});
  $effect(() => {
    try {
      widths = JSON.parse(localStorage.getItem(key()) ?? "{}");
    } catch {
      widths = {};
    }
  });
  return {
    of: (name: string, initial = fallback) => widths[name] ?? initial,
    resize(event: PointerEvent, name: string, initial = fallback) {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const start = widths[name] ?? initial;
      const move = (e: PointerEvent) =>
        (widths = { ...widths, [name]: Math.max(MIN_WIDTH, start + e.clientX - startX) });
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          localStorage.setItem(key(), JSON.stringify(widths));
        } catch (error) {
          console.warn("[view] could not remember column widths", error);
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
  };
}
