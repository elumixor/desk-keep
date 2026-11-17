import type { Editor } from "@tiptap/core";
import { type Component, mount, unmount } from "svelte";
import { POPUP } from "$lib/popup";

const GAP = 4;
const MARGIN = 8;

/**
 * A menu under `at` in the editor (above it when there is no room below). Escape closes it and puts the caret back at
 * `back()`; a click outside closes it and leaves the focus where the click put it. `props` gets `close` for the menu.
 */
export function caretPopup<P extends Record<string, unknown>>(
  editor: Editor,
  at: number,
  menuComponent: Component<P>,
  props: (close: (focus: boolean) => void) => P,
  back: () => number,
) {
  const host = document.createElement("div");
  host.className = `fixed z-50 w-80 max-w-[calc(100vw-1rem)] text-left ${POPUP}`;
  document.body.append(host);

  const close = (focus: boolean) => {
    removeEventListener("mousedown", outside, true);
    removeEventListener("keydown", onEscape, true);
    void unmount(menu);
    host.remove();
    if (!focus) return;
    // Tiptap focuses a frame later: keys pressed right after Enter would land on the page instead.
    editor.view.focus();
    editor.commands.focus(back());
  };
  const outside = (event: MouseEvent) => {
    if (!host.contains(event.target as Node)) close(false);
  };
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };

  const menu = mount(menuComponent, { target: host, props: props(close) });
  addEventListener("mousedown", outside, true);
  addEventListener("keydown", onEscape, true);

  const caret = editor.view.coordsAtPos(at);
  const place = () => {
    const { offsetWidth: w, offsetHeight: h } = host;
    const left = Math.min(Math.max(MARGIN, caret.left), innerWidth - w - MARGIN);
    const below = caret.bottom + GAP;
    const top = below + h > innerHeight - MARGIN && caret.top - h - GAP > MARGIN ? caret.top - h - GAP : below;
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  };
  place();
  requestAnimationFrame(place);
}
