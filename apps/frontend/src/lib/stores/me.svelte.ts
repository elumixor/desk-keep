import { api } from "../api";
import { auth } from "../auth.svelte";
import { notices } from "./notices.svelte";

type Me = Awaited<ReturnType<typeof api.me.$get>>;

/** Who is signed in, as Keep knows them (account id `id`, People id `peopleId`): asked once per sign-in, when first read. */
class Signed {
  #found = $state.raw<{ readonly userId: string; readonly me: Me } | null>(null);
  #asked: string | null = null;

  get current() {
    const userId = auth.userId;
    if (userId && this.#asked !== userId) {
      this.#asked = userId;
      api.me.$get().then((me) => (this.#found = { userId, me }), notices.error.bind(notices));
    }
    return this.#found?.userId === userId ? this.#found.me : null;
  }
}

export const me = new Signed();
