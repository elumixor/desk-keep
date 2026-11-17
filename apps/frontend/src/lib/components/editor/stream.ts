import type { Editor, JSONContent } from "@tiptap/core";

/** How many blocks a page opens with: about a screenful, drawn at once. The rest follow a batch a frame. */
export const FIRST_BLOCKS = 30;
const BATCH = 40;
/** Each block starts this long after the one above, up to `STAGGER_CAP` for the whole page. */
const STAGGER_MS = 18;
const STAGGER_CAP_MS = 360;

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Fades in the top-level blocks from `from` on, one after another. Through the Web Animations API, so the DOM the
 * editor owns is never touched. While the page's first blocks come in, the editor is marked `data-appearing` (the Vim cursor waits it out), and
 * redraws once they settle.
 */
export function appear(editor: Editor, from = 0) {
  if (still()) return;
  const { doc } = editor.state;
  let pos = 0;
  const moving: Promise<unknown>[] = [];
  for (let index = 0; index < doc.childCount; index++) {
    const node = doc.child(index);
    if (index >= from) {
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        const animation = dom.animate(
          [
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: 220,
            delay: Math.min((index - from) * STAGGER_MS, STAGGER_CAP_MS),
            easing: "ease-out",
            fill: "backwards",
          },
        );
        moving.push(animation.finished.catch(() => undefined));
      }
    }
    pos += node.nodeSize;
  }
  // Batches streamed in later slide in below a cursor already shown, so they leave it be.
  if (from || !moving.length) return;
  const { dom } = editor.view;
  dom.dataset.appearing = "";
  void Promise.all(moving).then(() => {
    delete dom.dataset.appearing;
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr);
  });
}

/**
 * Appends `pending` blocks to the end of the document a batch per frame, out of the history and without emitting an
 * update: they are the page as it was, not an edit. `pending` is drained in place, so what is still to come can be
 * saved along with an edit made meanwhile. Returns a stop.
 */
export function stream(editor: Editor, pending: JSONContent[]) {
  let frame = 0;
  const step = () => {
    if (!pending.length || editor.isDestroyed) return;
    const { state } = editor;
    const from = state.doc.childCount;
    const nodes = pending.splice(0, BATCH).map((block) => state.schema.nodeFromJSON(block));
    editor.view.dispatch(
      state.tr.insert(state.doc.content.size, nodes).setMeta("preventUpdate", true).setMeta("addToHistory", false),
    );
    appear(editor, from);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
