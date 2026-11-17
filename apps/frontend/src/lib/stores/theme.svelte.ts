import { applyTheme, DEFAULT_THEME, onSystemTheme, type Palette, type ThemeChoice } from "@desk/core";
import { stored, storedJson, storeJson } from "./stored";

const KEY = "keep.theme";

/** What this device chose; a bare "light" or "dark" is how Keep remembered a mode before palettes. */
function recall(): ThemeChoice {
  const mode = stored(KEY);
  if (mode === "light" || mode === "dark") return { ...DEFAULT_THEME, mode };
  return { ...DEFAULT_THEME, ...storedJson<Partial<ThemeChoice>>(KEY, {}) };
}

/**
 * Which palette is on: a light one and a dark one are chosen, and the mode says whether the system decides between
 * them. Applied as attributes on the root, which `@desk/core/tokens.css` reads, so the whole page follows.
 */
class Theme {
  choice = $state<ThemeChoice>(typeof document === "undefined" ? DEFAULT_THEME : recall());
  palette = $state<Palette | null>(typeof document === "undefined" ? null : applyTheme(this.choice));

  constructor() {
    if (typeof document !== "undefined") onSystemTheme(() => this.choice.mode === "system" && this.#apply());
  }

  get dark() {
    return this.palette?.kind === "dark";
  }

  choose(changes: Partial<ThemeChoice>) {
    this.choice = { ...this.choice, ...changes };
    storeJson(KEY, this.choice);
    this.#apply();
  }

  /** Flips to the other mode, keeping both palettes. */
  toggle() {
    this.choose({ mode: this.dark ? "light" : "dark" });
  }

  #apply() {
    this.palette = applyTheme(this.choice);
  }
}

export const theme = new Theme();
