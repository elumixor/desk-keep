import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { createWorkspace } from "~/lib/workspaces/create";

export default authed(
  { body: { title: z.string().min(1).max(200), icon: fields.icon.optional() } },
  ({ caller, body }) => createWorkspace(caller.person, body.title, body.icon ?? undefined),
);
