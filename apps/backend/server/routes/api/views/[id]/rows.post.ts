import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { createInView } from "~/lib/views";

/** "New" in a view: a page with its traits' properties and the values its filters ask for, under `parentId`. */
export default authed(
  {
    body: {
      title: fields.title.optional(),
      properties: fields.properties.optional(),
      parentId: fields.id.optional(),
    },
  },
  ({ caller, router, body }) => createInView(caller, router.id, body),
);
