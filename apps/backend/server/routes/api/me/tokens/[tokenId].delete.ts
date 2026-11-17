import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { tokens } from "~/db/schema";
import { authed } from "~/lib/http/authed";

export default authed(async ({ caller, router }) => {
  await db.delete(tokens).where(and(eq(tokens.id, router.tokenId), eq(tokens.personId, caller.person.id)));
  return { id: router.tokenId };
});
