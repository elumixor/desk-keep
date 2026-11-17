import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { traitPages } from "~/lib/traits";

/** What a relation constrained to the trait offers to pick. */
export default authed({ query: { q: z.string().max(200).default("") } }, ({ caller, router, query }) =>
  traitPages(caller, router.id, query.q),
);
