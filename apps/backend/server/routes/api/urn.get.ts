import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { resolveUrn } from "~/lib/pages/urn";

/** What a pill shows for a URN: title, icon and status of a `keep:page/…`; a Balance block (`https://balance.…/calendar?event=…` or `balance:block/…`) also carries the block. */
export default authed({ query: { urn: z.string().min(1) } }, ({ caller, query }) => resolveUrn(caller, query.urn));
