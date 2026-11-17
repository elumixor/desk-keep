import { z } from "zod";
import { mintToken } from "~/lib/auth/tokens";
import { authed } from "~/lib/http/authed";

/** A personal key, for MCP clients and scripts. The secret is in this answer and nowhere else. */
export default authed({ body: { name: z.string().min(1).max(100) } }, async ({ caller, body }) => {
  return mintToken({ personId: caller.person.id }, body.name);
});
