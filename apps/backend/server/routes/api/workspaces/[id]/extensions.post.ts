import { z } from "zod";
import { addExtension } from "~/lib/extensions/extensions";
import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";

export default authed(
  { body: { manifestUrl: fields.url, token: z.string().min(1).max(4000), name: z.string().max(100).optional() } },
  ({ caller, router, body }) => addExtension(caller, router.id, body),
);
