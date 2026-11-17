import { z } from "zod";
import { runAction } from "~/lib/extensions/extensions";
import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";

/** Runs an extension's action on the page and applies what it answers. */
export default authed(
  { body: { extension: fields.id.optional(), action: z.string().min(1).max(100) } },
  ({ caller, router, body }) => runAction(caller, router.id, { extensionId: body.extension, action: body.action }),
);
