import { z } from "zod";
import { ApiError } from "~/lib/http/api-error";
import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { sharePage } from "~/lib/shares";
import { SHARE_ROLES } from "~/model/access";

/** Shares the page (and what is under it) with a People person (`person`: id or URN) or an email; exactly one. */
export default authed(
  {
    body: {
      person: z.string().min(1).max(200).optional(),
      email: fields.email.optional(),
      name: z.string().min(1).max(200).optional(),
      role: z.enum(SHARE_ROLES),
    },
  },
  ({ caller, router, body }) => {
    if (!body.person === !body.email) throw new ApiError("Give `person` or `email`");
    return sharePage(
      caller,
      router.id,
      body.person ? { person: body.person } : { email: body.email as string, name: body.name },
      body.role,
    );
  },
);
