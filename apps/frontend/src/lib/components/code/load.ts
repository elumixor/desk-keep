/**
 * Monaco, fetched once: started when the app has settled (`preloadEditor`), so a script's editor opens at once instead
 * of waiting for its code to download, without holding up the page that loads first.
 */
let loading: Promise<typeof import("./monaco")> | undefined;

export const loadEditor = () => (loading ??= import("./monaco"));

/** Fetches the editor, and QuickJS for formulas, once the browser is idle after the page has loaded. */
export function preloadEditor() {
  const start = () => {
    void loadEditor();
    void import("$lib/scripts/formula.svelte").then(({ formulas }) => formulas.load());
  };
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 5000 });
  else setTimeout(start, 2000);
}
