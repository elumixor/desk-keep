interface Ask {
  readonly text: string;
  readonly action: string;
  readonly danger: boolean;
  /** Present when the question takes a typed answer, as the field's text. */
  value?: string;
  readonly run: (value: string) => void;
}

/** A question over the app, answered yes or with a line of text: Enter answers, Escape cancels. */
class Confirm {
  ask = $state<Ask | null>(null);

  show(text: string, action: string, run: () => void, danger = false) {
    this.ask = { text, action, danger, run };
  }

  /** Asks for a line of text, starting from `value`; an empty answer cancels. */
  prompt(text: string, action: string, run: (value: string) => void, value = "") {
    this.ask = { text, action, danger: false, value, run };
  }

  yes() {
    const ask = this.ask;
    this.ask = null;
    if (!ask) return;
    const value = ask.value?.trim() ?? "";
    if (ask.value !== undefined && !value) return;
    ask.run(value);
  }

  no() {
    this.ask = null;
  }
}

export const confirm = new Confirm();
