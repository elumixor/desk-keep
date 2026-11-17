import { Overlay } from "./overlay.svelte";

/** Whether the ⌘K palette is open; anything can open it, or borrow it to pick a page. */
class Palette extends Overlay {
  /** Only pages, found by title (`space e`), or pages, people and commands too (⌘K). */
  pagesOnly = $state(false);
  /** Set while the palette is choosing a page for a caller instead of navigating. */
  picker = $state<{
    prompt: string;
    exclude: ReadonlySet<string>;
    first: readonly string[];
    onpick: (id: string) => void;
  } | null>(null);

  override show() {
    this.picker = null;
    this.pagesOnly = false;
    super.show();
  }
  /** Opens the palette on pages alone. */
  find() {
    this.show();
    this.pagesOnly = true;
  }
  /** `first` are the pages offered at the top (the first one selected) until something is typed. */
  pick(prompt: string, exclude: ReadonlySet<string>, onpick: (id: string) => void, first: readonly string[] = []) {
    this.picker = { prompt, exclude, first, onpick };
    super.show();
  }
}

export const palette = new Palette();
