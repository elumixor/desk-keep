import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { updateTrait } from "~/lib/traits";
import { traitInputSchema } from "~/model/traits";

export default authed(
  {
    body: {
      name: traitInputSchema.shape.name.optional(),
      icon: fields.icon.optional(),
      properties: fields.schema.optional(),
      renames: fields.renames.optional(),
      drop: z.array(z.string()).optional(),
      dropFromPages: z.boolean().optional(),
    },
  },
  ({ caller, router, body }) => updateTrait(caller, router.id, body),
);
