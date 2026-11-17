import { local } from "../sync/local.svelte";

export type ViewResult = NonNullable<ReturnType<typeof local.viewResult>>;
export type ViewRow = ViewResult["rows"][number];

/**
 * What each view selects, worked out on the device from the synced records (`lib/sync/local.svelte.ts`), so an edit
 * to a page shows in every view at once, and a view's filters and sorts apply as they are changed.
 */
export const viewRows = {
  get: (viewId: string): ViewResult | undefined => local.viewResult(viewId),
};
