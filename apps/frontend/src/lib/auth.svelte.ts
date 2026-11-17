import { Clerk } from "@clerk/clerk-js";
import { onDeskDomain, signInUrl, startClerk } from "@desk/core";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/** The Clerk session, loaded once; screens wait on `loaded` and read `signedIn`. */
class Auth {
  loaded = $state(false);
  signedIn = $state(false);
  /** Whose records the device holds (`lib/sync`). */
  userId = $state<string | null>(null);
  error = $state<string | null>(null);
  #ready: Promise<Clerk> | null = null;

  load() {
    this.#ready ??= this.#load();
    return this.#ready;
  }

  async #load() {
    let clerk: Clerk;
    try {
      clerk = await startClerk(Clerk, CLERK_PUBLISHABLE_KEY);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.loaded = true;
      throw error;
    }
    this.signedIn = Boolean(clerk.session);
    this.userId = clerk.user?.id ?? null;
    clerk.addListener(({ session, user }) => {
      this.signedIn = Boolean(session);
      this.userId = user?.id ?? null;
    });
    this.loaded = true;
    return clerk;
  }

  /** A short-lived session token for the API, refreshed by Clerk as it nears expiry. */
  async token() {
    const clerk = await this.load();
    return (await clerk.session?.getToken()) ?? null;
  }

  /** On the suite's domain the one sign-in is People's, which sends the browser back; elsewhere (dev, tests) it happens here. */
  async mountSignIn(element: HTMLDivElement, redirect: string) {
    if (onDeskDomain()) {
      location.assign(signInUrl(new URL(redirect, location.origin).href));
      return () => {};
    }
    const clerk = await this.load();
    clerk.mountSignIn(element, { forceRedirectUrl: redirect, signUpForceRedirectUrl: redirect });
    return () => clerk.unmountSignIn(element);
  }

  /** `beforeSignOut` takes the person's records off the device before the session goes. */
  async signOut(beforeSignOut?: () => Promise<void>) {
    const clerk = await this.load();
    await beforeSignOut?.();
    await clerk.signOut({ redirectUrl: "/" });
  }
}

export const auth = new Auth();
