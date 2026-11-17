import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { webhookDeliveries, webhooks } from "~/db/schema";
import type { EventType } from "~/model/watch";
import type { Caller } from "../auth/caller";
import { seal } from "../extensions/secret";
import { NotFoundError } from "../http/api-error";
import { authorizeWorkspace } from "../permissions";

/** A workspace's hooks, each with how its last delivery went; never their secrets. */
export async function listWebhooks(caller: Caller, workspaceId: string) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  const rows = await db.query.webhooks.findMany({ where: eq(webhooks.workspaceId, workspaceId) });
  const last = rows.length
    ? await db
        .selectDistinctOn([webhookDeliveries.webhookId], {
          webhookId: webhookDeliveries.webhookId,
          state: webhookDeliveries.state,
          at: webhookDeliveries.createdAt,
          sentAt: webhookDeliveries.sentAt,
          attempts: webhookDeliveries.attempts,
          error: webhookDeliveries.lastError,
          type: webhookDeliveries.event,
        })
        .from(webhookDeliveries)
        .where(
          inArray(
            webhookDeliveries.webhookId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(webhookDeliveries.webhookId, desc(webhookDeliveries.createdAt))
    : [];
  return rows.map(({ secret: _secret, ...row }) => {
    const delivery = last.find((d) => d.webhookId === row.id);
    return {
      ...row,
      lastDelivery: delivery
        ? {
            state: delivery.state,
            event: delivery.type.type,
            at: (delivery.sentAt ?? delivery.at).toISOString(),
            attempts: delivery.attempts,
            error: delivery.error,
          }
        : null,
    };
  });
}

/** The secret signs every delivery (`x-keep-signature`): kept sealed, shown once, here. */
export async function createWebhook(caller: Caller, workspaceId: string, url: string, events: readonly EventType[]) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  const secret = randomBytes(24).toString("base64url");
  const [hook] = await db
    .insert(webhooks)
    .values({ workspaceId, url, secret: seal(secret), events: [...new Set(events)] })
    .returning();
  return { ...hook, secret };
}

/** Which events a hook is sent. */
export async function updateWebhook(caller: Caller, workspaceId: string, id: string, events: readonly EventType[]) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  const [hook] = await db
    .update(webhooks)
    .set({ events: [...new Set(events)] })
    .where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)))
    .returning({ id: webhooks.id, url: webhooks.url, events: webhooks.events });
  if (!hook) throw new NotFoundError("Webhook");
  return hook;
}

export async function deleteWebhook(caller: Caller, workspaceId: string, id: string) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  const [deleted] = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)))
    .returning();
  if (!deleted) throw new NotFoundError("Webhook");
  return { id };
}
