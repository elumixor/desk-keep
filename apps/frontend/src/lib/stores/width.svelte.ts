import { storedJson, storeJson } from "./stored";

const KEY = "keep.width";

/** Which pages are shown full width: one showing a view is unless told otherwise, a page is not. Remembered per page. */
class Width {
  #chosen = $state<Record<string, boolean>>(storedJson(KEY, {}));

  wide(id: string, hasViews: boolean) {
    return this.#chosen[id] ?? hasViews;
  }

  set(id: string, wide: boolean) {
    this.#chosen = { ...this.#chosen, [id]: wide };
    storeJson(KEY, this.#chosen);
  }
}

export const width = new Width();
