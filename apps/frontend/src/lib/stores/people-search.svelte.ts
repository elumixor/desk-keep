import { notices } from "./notices.svelte";
import { people } from "./people.svelte";
import { type PeopleGroup, type PeoplePerson, peopleApi } from "./people-api.svelte";

const DEBOUNCE_MS = 120;

/** The open workspace's members as People persons (the ones linked to People). */
export const memberPeople = (): PeoplePerson[] =>
  people.members.flatMap((m) =>
    m.peopleId
      ? [
          {
            id: m.peopleId,
            name: peopleApi.person(m.peopleId)?.name ?? m.name,
            emails: m.email ? [m.email] : [],
            avatar: peopleApi.person(m.peopleId)?.avatar ?? m.avatar,
          } satisfies PeoplePerson,
        ]
      : [],
  );

/** People's search for `q`, the open workspace's members first. */
export async function findPeople(q: string): Promise<PeoplePerson[]> {
  const found = await peopleApi.search(q);
  return membersFirst(found);
}

const membersFirst = (found: readonly PeoplePerson[]) =>
  [...found].sort((a, b) => Number(people.memberIds.has(b.id)) - Number(people.memberIds.has(a.id)));

/**
 * Finding people in People as `query` is typed: the open workspace's members while it is empty, else People's search
 * with members first. Made in a component, whose life it searches for.
 */
export class PeopleSearch {
  query = $state("");
  #found = $state<readonly PeoplePerson[]>([]);
  #groups = $state<readonly PeopleGroup[]>([]);

  readonly q = $derived(this.query.trim());
  readonly members = $derived(memberPeople());
  readonly #shownAlone = $derived(this.q ? membersFirst(this.#found) : this.members);
  /** Who to offer on their own: whoever is in a listed group is offered inside it. */
  readonly shown = $derived.by(() => {
    const grouped = new Set(this.#groups.flatMap((g) => g.members.map((m) => m.id)));
    return this.#shownAlone.filter((p) => !grouped.has(p.id));
  });
  /** Somebody found has exactly the name typed. */
  readonly exact = $derived(this.#found.some((p) => p.name.toLowerCase() === this.q.toLowerCase()));
  /** Groups to offer: all of them, or those whose name or a member's matches the query. */
  readonly groups = $derived(
    this.#groups.filter((g) => [g, ...g.members].some((x) => x.name.toLowerCase().includes(this.q.toLowerCase()))),
  );

  constructor() {
    peopleApi.groups().then(
      (found) => (this.#groups = found),
      (error) => notices.error(error),
    );
    $effect(() => {
      const text = this.q;
      if (!text) {
        this.#found = [];
        return;
      }
      const timer = setTimeout(() => {
        peopleApi.search(text).then(
          (result) => {
            if (text === this.q) this.#found = result;
          },
          (error) => notices.error(error),
        );
      }, DEBOUNCE_MS);
      return () => clearTimeout(timer);
    });
  }
}
