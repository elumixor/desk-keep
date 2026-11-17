import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { findPeople } from "~/lib/people-api/directory";

/** People matching `q`, for the pickers and the palette. */
export default authed({ query: { q: z.string().max(200) } }, ({ query }) => findPeople(query.q));
