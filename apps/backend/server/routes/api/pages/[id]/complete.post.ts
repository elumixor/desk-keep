import { z } from "zod";
import { complete } from "~/lib/completion";
import { authed } from "~/lib/http/authed";

const DOCUMENT_LIMIT = 100_000;

/**
 * What the model would write at the cursor of the page, sent as Markdown with the cursor marked
 * (`model/completion.ts`), streamed as it is written: each event is the whole text so far.
 */
export default authed(
  { body: { document: z.string().max(DOCUMENT_LIMIT) } },
  async function* ({ caller, router, body }) {
    yield* complete(caller, router.id, body.document);
  },
);
