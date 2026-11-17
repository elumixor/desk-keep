import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { updatePage } from "~/lib/pages/write";

export default authed(
  {
    body: {
      title: fields.title.optional(),
      icon: fields.icon.optional(),
      description: fields.description.optional(),
      body: fields.body.optional(),
      properties: fields.properties.optional(),
      schema: fields.schema.optional(),
      addProperties: fields.schema.optional(),
      renames: fields.renames.optional(),
      traits: fields.traits.optional(),
      baseUpdatedAt: z.iso.datetime().optional(),
    },
  },
  ({ caller, router, body }) => updatePage(caller, router.id, body),
);
