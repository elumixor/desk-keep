import { z } from "zod";
import { extensionOptions } from "~/lib/extensions/extensions";
import { authed } from "~/lib/http/authed";

/** The picker's choices for one of the extension's property types, asked of the app with Keep's token. */
export default authed(
  { query: { type: z.string().min(1).max(100), q: z.string().max(200).default("") } },
  ({ caller, router, query }) => extensionOptions(caller, router.id, router.extensionId, query.type, query.q),
);
