import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { search } from "~/lib/pages/search";
import { SEARCH_BY } from "~/model/search";

export default authed(
  { query: { q: z.string().max(200), by: z.enum(SEARCH_BY).optional() } },
  ({ caller, router, query }) => search(caller, { workspaceId: router.id, query: query.q, by: query.by }),
);
