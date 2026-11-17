import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { findGroups } from "~/lib/people-api/directory";

/** People's groups with their members, for the pickers. */
export default authed({ query: { q: z.string().max(200).optional() } }, ({ query }) => findGroups(query.q));
