/** The property just added, whose name field takes the focus where it shows: once, in the first place that asks. */
class NewProperty {
  #name = $state<string | null>(null);

  mark(name: string) {
    this.#name = name;
  }

  /** Whether `name` is the property just added; taken, so no other place focuses it too. */
  take(name: string) {
    if (this.#name !== name) return false;
    this.#name = null;
    return true;
  }
}

export const newProperty = new NewProperty();
