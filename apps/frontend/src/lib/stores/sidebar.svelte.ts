import { store, stored } from "./stored";

const NARROW = "(max-width: 767px)";
const KEY = "keep:sidebar-width";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
/** Dragged narrower than this, the sidebar collapses. */
export const SIDEBAR_COLLAPSE = 140;

/** The sidebar: open on a wide screen, closed on a phone, where it floats over the page and closes after a pick. */
class Sidebar {
  narrow = $state(false);
  open = $state(true);
  width = $state(240);
  /** The workspace switcher at the top of the sidebar. */
  switcher = $state(false);

  constructor() {
    const saved = Number(stored(KEY));
    if (saved) this.resize(saved);
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(NARROW);
    this.narrow = media.matches;
    this.open = !media.matches;
    media.addEventListener("change", () => {
      this.narrow = media.matches;
      this.open = !media.matches;
    });
  }

  resize(width: number) {
    this.width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));
  }

  saveWidth() {
    store(KEY, String(this.width));
  }

  toggle() {
    this.open = !this.open;
  }

  showSwitcher() {
    this.open = true;
    this.switcher = true;
  }

  /** After navigating: a phone's sidebar gets out of the way. */
  settle() {
    if (this.narrow) this.open = false;
  }
}

export const sidebar = new Sidebar();
