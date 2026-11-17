import { createSubscriber } from "svelte/reactivity";

const TICK_MS = 60_000;

/** The current time, read reactively: whatever shows "5m ago" is redrawn each minute, and nothing ticks unread. */
class Now {
  readonly #subscribe = createSubscriber((update) => {
    const timer = setInterval(update, TICK_MS);
    return () => clearInterval(timer);
  });

  get value() {
    this.#subscribe();
    return new Date();
  }
}

export const now = new Now();
