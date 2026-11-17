import { api, KeepApiError } from "$lib/api";
import { completion } from "$lib/stores/completion.svelte";

const NOT_SET_UP = 503;

/**
 * What the server's model writes at the cursor, given to `onText` as it grows (each time the whole text so far);
 * nothing once the server has said it has no model.
 */
export async function requestCompletion(
  pageId: string,
  document: string,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<void> {
  if (completion.unavailable) return;
  const stream = api.pages(pageId).complete.$post({ document });
  signal.addEventListener("abort", () => stream.abort(), { once: true });
  try {
    for await (const { text } of stream) onText(text);
    await stream.done;
  } catch (error) {
    if (error instanceof KeepApiError && error.status === NOT_SET_UP) {
      completion.unavailable = true;
      return;
    }
    throw error;
  }
}
