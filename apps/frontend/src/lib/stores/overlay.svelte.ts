const focused = () => (document.activeElement instanceof HTMLElement ? document.activeElement : null);

/** What opens over the page and, once closed, gives focus back where it was: the editor keeps its cursor and mode. */
export class Overlay {
  open = $state(false);
  #returnTo: HTMLElement | null = null;

  show() {
    this.#returnTo = focused();
    this.open = true;
  }

  hide() {
    this.open = false;
    // Gone once the overlay navigated away.
    if (this.#returnTo?.isConnected) this.#returnTo.focus();
    this.#returnTo = null;
  }
}
