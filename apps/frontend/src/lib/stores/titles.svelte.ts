import { getJson } from "../http";

interface Pill {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
}

/** Titles of pages a relation points to, fetched once each. */
class Titles {
  #known = $state<Record<string, Pill>>({});
  #asked = new Set<string>();

  get(id: string): Pill | undefined {
    if (!this.#known[id] && !this.#asked.has(id)) {
      this.#asked.add(id);
      getJson<Pill>("/api/urn", { urn: `keep:page/${id}` })
        .then((pill) => (this.#known[id] = pill))
        .catch((error) => console.warn(`[titles] ${id}`, error));
    }
    return this.#known[id];
  }

  remember(id: string, title: string, icon: string | null = null) {
    this.#known[id] = { id, title, icon };
  }
}

export const titles = new Titles();
