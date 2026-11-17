import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { addEmoji } from "~/lib/workspaces/emoji";

export default authed(
  { body: { name: z.string().min(1).max(100), image: z.string().min(1) } },
  ({ caller, router, body }) => addEmoji(caller, router.id, body),
);
