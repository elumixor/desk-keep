import type { Trash2 } from "lucide-svelte";

/** What a notice came from, said small under it: a button, say, on the page it was pressed on. */
export interface NoticeSource {
  readonly label: string;
  readonly pageId?: string;
}

interface Notice {
  readonly id: number;
  readonly text: string;
  readonly tone: "info" | "error";
  readonly icon?: typeof Trash2;
  readonly action?: { readonly label: string; readonly run: () => void };
  readonly source?: NoticeSource;
}

interface NoticeOptions {
  readonly tone?: Notice["tone"];
  readonly icon?: Notice["icon"];
  readonly action?: Notice["action"];
  readonly source?: NoticeSource;
  /** How long it stays, in ms; one with an action stays longer by default, to be acted on. */
  readonly lifetime?: number;
}

const LIFETIME_MS = 5000;
const ACTION_LIFETIME_MS = 10_000;

/** Short messages in the corner: a save that failed, a page that changed elsewhere. */
class Notices {
  list = $state<Notice[]>([]);
  #next = 0;

  show(text: string, options: Notice["tone"] | NoticeOptions = "info") {
    const {
      tone = "info",
      lifetime,
      ...rest
    }: NoticeOptions = typeof options === "string" ? { tone: options } : options;
    const notice: Notice = { id: this.#next++, text, tone, ...rest };
    this.list = [...this.list, notice];
    setTimeout(() => this.dismiss(notice.id), lifetime ?? (rest.action ? ACTION_LIFETIME_MS : LIFETIME_MS));
  }

  error(error: unknown) {
    this.show(error instanceof Error ? error.message : String(error), "error");
  }

  dismiss(id: number) {
    this.list = this.list.filter((n) => n.id !== id);
  }
}

export const notices = new Notices();
