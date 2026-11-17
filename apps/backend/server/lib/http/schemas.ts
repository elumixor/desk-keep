import { z } from "zod";
import { ROLES } from "~/db/schema";
import { CLIENT_TAG } from "~/lib/auth/caller";
import { docSchema } from "~/model/document";
import { ICON_MAX } from "~/model/icons";
import { DESCRIPTION_MAX } from "~/model/nodes";
import { schemaSchema } from "~/model/properties";
import { filterSchema, sortSchema, VIEW_KINDS } from "~/model/views";
import { EVENTS } from "~/model/watch";

/** Request fields shared by the REST routes and the MCP tools, so both refuse the same things the same way. */
export const fields = {
  id: z.uuid(),
  title: z.string().max(500),
  /** An emoji, or `lucide:<name>[:<color>]`, `noto:<codepoint>`, `custom:<id>`, `image:<data URL>` (see `model/icons.ts`). */
  icon: z.string().max(ICON_MAX).nullable(),
  description: z.string().max(DESCRIPTION_MAX),
  body: docSchema,
  properties: z.record(z.string(), z.unknown()),
  schema: schemaSchema,
  /** Properties renamed, old name to new: their values move with them. */
  renames: z.record(z.string(), z.string().trim().min(1).max(200)),
  /** Traits by id, name or path ("Projects/Task"). */
  traits: z.array(z.string().min(1).max(500)),
  viewKind: z.enum(VIEW_KINDS),
  filter: z.array(filterSchema),
  sort: z.array(sortSchema),
  role: z.enum(ROLES),
  email: z.email(),
  url: z.url(),
  events: z.array(z.enum(EVENTS)).min(1),
  /** A client tag (`x-keep-client`), e.g. `pai:thread/<id>`. */
  client: z.string().regex(CLIENT_TAG),
};
