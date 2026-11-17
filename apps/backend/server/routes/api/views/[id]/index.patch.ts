import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { updateView } from "~/lib/views";

export default authed(
  {
    body: {
      name: z.string().min(1).max(100).optional(),
      icon: fields.icon.optional(),
      kind: fields.viewKind.optional(),
      traits: z.array(fields.id).optional(),
      filter: fields.filter.optional(),
      sort: fields.sort.optional(),
      groupBy: z.string().nullable().optional(),
      visibleProperties: z.array(z.string()).nullable().optional(),
      barProperties: z.array(z.string()).nullable().optional(),
      sortCode: z.string().max(10_000).nullable().optional(),
      newParent: fields.id.nullable().optional(),
    },
  },
  ({ caller, router, body }) => updateView(caller, router.id, body),
);
