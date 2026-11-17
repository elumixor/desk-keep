import { api } from "../api";
import { getJson } from "../http";

const PEOPLE_URL = import.meta.env.VITE_PEOPLE_URL;

/** A person as Keep shows one. */
export type PeoplePerson = ReturnType<typeof api.people>["$get"]["$response"];
export type PeopleGroup = {
  readonly id: string;
  readonly name: string;
  readonly avatar: string | null;
  readonly leaderId: string | null;
  readonly members: readonly PeoplePerson[];
};

/**
 * People live in the People app, which Keep's backend asks on the browser's behalf. People seen once are kept by id, so a
 * person value renders its name and avatar from the cache and is fetched only the first time.
 */
class PeopleApi {
  #byId = $state<Record<string, PeoplePerson | null>>({});
  readonly #pending = new Set<string>();

  /** Where a person opens in People's own app. */
  url(id: string) {
    return `${PEOPLE_URL}/p/${id}`;
  }

  /** The person, once known; asks People the first time. `undefined` while loading, `null` when People has none. */
  person(id: string): PeoplePerson | null | undefined {
    if (!(id in this.#byId) && !this.#pending.has(id)) void this.#fetch(id);
    return this.#byId[id];
  }

  async search(q: string) {
    const found = await getJson<PeoplePerson[]>("/api/people", { q });
    this.#remember(found);
    return found;
  }

  async groups(q = "") {
    const found = await getJson<PeopleGroup[]>("/api/groups", q ? { q } : {});
    this.#remember(found.flatMap((g) => [{ id: g.id, name: g.name, emails: [], avatar: g.avatar }, ...g.members]));
    return found;
  }

  async create(name: string) {
    const person = await api.people.$post({ name });
    this.#remember([person]);
    return person;
  }

  #remember(people: readonly PeoplePerson[]) {
    this.#byId = { ...this.#byId, ...Object.fromEntries(people.map((p) => [p.id, p])) };
  }

  async #fetch(id: string) {
    this.#pending.add(id);
    try {
      this.#remember([await api.people(id).$get()]);
    } catch (error) {
      console.warn("[People]", id, error);
      this.#byId = { ...this.#byId, [id]: null };
    } finally {
      this.#pending.delete(id);
    }
  }
}

export const peopleApi = new PeopleApi();
