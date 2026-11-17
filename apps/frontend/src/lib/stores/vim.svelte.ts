import { store, stored } from "./stored";

const KEY = "keep.vim";
const NUMBERS = "keep.vim.numbers";
const SIDE = "keep.vim.numbers.side";
const SCROLLOFF = "keep.vim.scrolloff";

type LineNumbers = "off" | "absolute" | "relative";

/** Vim mode in the page editor and Zed's shortcuts around it, on or off on this device. */
class Vim {
  enabled = $state(stored(KEY) === "on");
  /** Lines kept visible above and below the cursor as it moves (Vim's `scrolloff`). */
  scrolloff = $state(Number(stored(SCROLLOFF) ?? 4) || 0);

  /** Line numbers beside the page: off, absolute, or relative to the cursor. */
  lineNumbers = $state<LineNumbers>(numbers(stored(NUMBERS)));

  /** Which border of the page the line numbers sit at. */
  numbersSide = $state<"left" | "right">(stored(SIDE) === "left" ? "left" : "right");

  setNumbersSide(side: "left" | "right") {
    this.numbersSide = side;
    store(SIDE, side);
  }

  setLineNumbers(mode: LineNumbers) {
    this.lineNumbers = mode;
    store(NUMBERS, mode);
  }

  toggle() {
    this.enabled = !this.enabled;
    store(KEY, this.enabled ? "on" : "off");
  }

  setScrolloff(lines: number) {
    this.scrolloff = Math.max(0, Math.min(20, Math.round(lines) || 0));
    store(SCROLLOFF, String(this.scrolloff));
  }
}

function numbers(value: string | null): LineNumbers {
  return value === "absolute" || value === "relative" ? value : "off";
}

export const vim = new Vim();
