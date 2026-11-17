import { eq } from "drizzle-orm";
import { db } from "~/db";
import { tokens } from "~/db/schema";
import { authed } from "~/lib/http/authed";

export default authed(async ({ caller }) => {
  return await db
    .select({ id: tokens.id, name: tokens.name, createdAt: tokens.createdAt, lastUsedAt: tokens.lastUsedAt })
    .from(tokens)
    .where(eq(tokens.personId, caller.person.id));
});
