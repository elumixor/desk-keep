import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { createPage } from "~/lib/pages/write";

export default authed(
  {
    body: {
      parentId: fields.id,
      title: fields.title.optional(),
      icon: fields.icon.optional(),
      body: fields.body.optional(),
      properties: fields.properties.optional(),
      schema: fields.schema.optional(),
      addProperties: fields.schema.optional(),
      traits: fields.traits.optional(),
    },
  },
  ({ caller, body: { parentId, ...input } }) => createPage(caller, parentId, input),
);
