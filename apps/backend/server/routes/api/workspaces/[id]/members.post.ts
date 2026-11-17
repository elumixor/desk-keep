import { z } from "zod";
import { ApiError } from "~/lib/http/api-error";
import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { invite } from "~/lib/workspaces/members";

/** Invites a People person (`person`: id or People address) or an email; exactly one of them. */
export default authed(
  {
    body: {
      person: z.string().min(1).max(200).optional(),
      email: fields.email.optional(),
      role: fields.role,
      name: z.string().min(1).max(200).optional(),
    },
  },
  ({ caller, router, body }) => {
    if (!body.person === !body.email) throw new ApiError("Give `person` or `email`");
    return invite(
      caller,
      router.id,
      body.person ? { person: body.person } : { email: body.email as string, name: body.name },
      body.role,
    );
  },
);
