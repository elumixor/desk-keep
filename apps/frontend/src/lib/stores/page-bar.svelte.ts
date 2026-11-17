import type { ShareRole } from "$model/access";
import type { PageData } from "./pages.svelte";

/** Somebody the share dialog offers to share the page with as it opens: named on a page they cannot see. */
export interface ShareSuggestion {
  readonly pageId: string;
  readonly person: { readonly id: string; readonly name: string };
  readonly role: ShareRole;
}

/** What the open page tells the top bar, which stays put across pages: a page in the trash, and how to trash it. */
class PageBar {
  id = $state<string | null>(null);
  /** The page as it was, while it sits in the trash and so is not among the synced records. */
  kept = $state.raw<PageData>();
  trashedAt = $state<string | null>(null);
  remove = $state<() => void>(() => {});
  /** The page whose share dialog is in the top bar now, if any: only it takes a `share` request. */
  sharing = $state<string | null>(null);
  /** Set to open the open page's share dialog with somebody to add. */
  share = $state.raw<ShareSuggestion | null>(null);
}

export const pageBar = new PageBar();
