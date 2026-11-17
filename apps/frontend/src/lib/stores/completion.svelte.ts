import { store, stored } from "./stored";

const KEY = "keep.completion";

/** Ghost-text completions in the page editor, on or off on this device; off for the session when the server has none. */
class Completion {
  enabled = $state(stored(KEY) !== "off");
  /** The server answered that it has no model: asking again this session would only fail the same way. */
  unavailable = $state(false);

  toggle() {
    this.enabled = !this.enabled;
    store(KEY, this.enabled ? "on" : "off");
  }
}

export const completion = new Completion();
