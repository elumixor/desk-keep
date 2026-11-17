import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { createTrait } from "~/lib/traits";
import { traitInputSchema } from "~/model/traits";

export default authed(
  {
    body: {
      name: traitInputSchema.shape.name,
      icon: fields.icon.optional(),
      properties: fields.schema.optional(),
      /** The node it goes under; the workspace when absent. */
      parentId: fields.id.optional(),
    },
  },
  ({ caller, router, body }) => createTrait(caller, router.id, body),
);
