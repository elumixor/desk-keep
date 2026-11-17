import { eq, like, not } from "drizzle-orm";
import { db } from "~/db";
import { webhooks } from "~/db/schema";
import { seal } from "../extensions/secret";

/** Seals the signing secrets of hooks written before secrets were kept sealed; the same secret keeps signing. */
export async function sealWebhookSecrets() {
  const plain = await db
    .select({ id: webhooks.id, secret: webhooks.secret })
    .from(webhooks)
    .where(not(like(webhooks.secret, "v1.%")));
  for (const hook of plain)
    await db
      .update(webhooks)
      .set({ secret: seal(hook.secret) })
      .where(eq(webhooks.id, hook.id));
  return { sealed: plain.length };
}
