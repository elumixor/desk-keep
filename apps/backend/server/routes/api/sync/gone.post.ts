import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { buryGone } from "~/lib/sync";

/** The pages a device holds, checked against the server: the ones gone for good are taken off with its next sync. */
export default authed(
  { body: { pages: z.array(z.object({ id: z.uuid(), workspaceId: z.uuid() })).max(20_000) } },
  ({ caller, body }) => buryGone(caller, body.pages),
);
