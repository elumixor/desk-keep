/** What a question asks for, as the server's script host says (`ASK_KINDS`). */
export type AskKind = "text" | "number" | "checkbox" | "date" | "options";

/** A question a button's script asks whoever pressed it (`ask()`), shown by `ScriptAsk` over everything. */
export interface ScriptQuestion {
  readonly question: string;
  readonly kind: AskKind;
  readonly options?: readonly string[];
}

/** The button that asks, and the page it was pressed on. */
export interface QuestionSource {
  readonly label: string;
  readonly pageId: string;
}

type Asking = ScriptQuestion & { readonly source: QuestionSource; readonly answer: (value: string | null) => void };

class ScriptAsk {
  current = $state<Asking | null>(null);

  /** The answer as text (a checkbox's `"true"` or `"false"`), or null when it was dismissed. */
  ask(question: ScriptQuestion, source: QuestionSource): Promise<string | null> {
    return new Promise((resolve) => {
      this.current = {
        ...question,
        source,
        answer: (value) => {
          this.current = null;
          resolve(value);
        },
      };
    });
  }
}

export const scriptAsk = new ScriptAsk();
