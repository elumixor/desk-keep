import { createHmac } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { notifications, webhookDeliveries, webhooks } from "~/db/schema";
import { open } from "../extensions/secret";
import { PeopleApiError, peopleApi } from "../people-api/client";
import { toNotification } from "./inbox";

/**
 * The outbox's sender: what is due of `notification` goes to People (`POST /api/notify`), what is due of
 * `webhook_delivery` to its hook. A row is leased first (its next attempt pushed out), so two drains at once (the
 * timer, a write's kick) never send it twice. A 2xx is done; a 5xx, 408, 429 or no answer is retried with backoff
 * (up to `MAX_ATTEMPTS`: about a day of waits, doubling from a minute to six hours); any other answer fails it for good.
 */
const LEASE = sql`interval '2 minutes'`;
const MAX_ATTEMPTS = 13;
const BACKOFF_MS = 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;
const TIMEOUT_MS = 5000;
const CONCURRENCY = 10;
const ERROR_MAX = 500;

export const signature = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/** Why an attempt did not go through, and whether trying again could help. */
class Undelivered extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
    this.name = "Undelivered";
  }
}

const retryable = (status: number | null) => status === null || status >= 500 || status === 408 || status === 429;

const backoff = (attempts: number) =>
  sql`now() + make_interval(secs => ${Math.min(BACKOFF_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS) / 1000})`;

/** What became of one attempt, as the row's next state. */
function outcome(error: unknown, attempts: number) {
  if (!error) return { state: "sent" as const, sentAt: sql`now()`, lastError: null };
  const retry =
    error instanceof Undelivered ? error.retry : error instanceof PeopleApiError ? retryable(error.status) : true;
  const lastError = (error instanceof Error ? error.message : String(error)).slice(0, ERROR_MAX);
  if (!retry || attempts >= MAX_ATTEMPTS) return { state: "failed" as const, lastError };
  return { state: "pending" as const, nextAttemptAt: backoff(attempts), lastError };
}

async function lease(table: "notification" | "webhook_delivery", limit: number) {
  const rows = await db.execute<{ id: string }>(sql`
    update ${sql.identifier(table)} set attempts = attempts + 1, next_attempt_at = now() + ${LEASE}
    where id in (
      select id from ${sql.identifier(table)} where state = 'pending' and next_attempt_at <= now()
      order by next_attempt_at limit ${limit} for update skip locked
    ) returning id`);
  return rows.map((r) => r.id);
}

async function inChunks<T>(items: readonly T[], run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += CONCURRENCY)
    await Promise.allSettled(items.slice(i, i + CONCURRENCY).map(run));
}

type Tally = { sent: number; failed: number; retried: number };

const count = (tally: Tally, state: "sent" | "failed" | "pending") => {
  if (state === "sent") tally.sent++;
  else if (state === "failed") tally.failed++;
  else tally.retried++;
};

async function drainNotifications(limit: number, tally: Tally) {
  const ids = await lease("notification", limit);
  if (!ids.length) return;
  const rows = await db.select().from(notifications).where(inArray(notifications.id, ids));
  await inChunks(rows, async (row) => {
    let error: unknown = null;
    try {
      await peopleApi.notify(toNotification(row));
    } catch (caught) {
      error = caught;
    }
    const next = outcome(error, row.attempts);
    if (error) console.warn(`[notify] ${row.id} to ${row.recipient}: ${next.lastError}`);
    await db.update(notifications).set(next).where(eq(notifications.id, row.id));
    count(tally, next.state);
  });
}

/** A hook's secret as it signs: sealed at rest; one written before sealing is read as it is (the backfill seals it). */
const secretOf = (stored: string) => (stored.startsWith("v1.") ? open(stored) : stored);

async function drainWebhooks(limit: number, tally: Tally) {
  const ids = await lease("webhook_delivery", limit);
  if (!ids.length) return;
  const rows = await db
    .select({ delivery: webhookDeliveries, url: webhooks.url, secret: webhooks.secret })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(inArray(webhookDeliveries.id, ids));
  await inChunks(rows, async ({ delivery, url, secret }) => {
    let error: unknown = null;
    try {
      let key: string;
      try {
        key = secretOf(secret);
      } catch {
        throw new Undelivered(
          "The hook's secret cannot be opened (EXTENSION_SECRET changed?): add the hook again",
          false,
        );
      }
      const body = JSON.stringify(delivery.event);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-keep-event": delivery.event.type,
            "x-keep-delivery": delivery.id,
            "x-keep-signature": signature(key, body),
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (caught) {
        throw new Undelivered(caught instanceof Error ? caught.message : String(caught), true);
      }
      if (!response.ok) throw new Undelivered(`Answered ${response.status}`, retryable(response.status));
    } catch (caught) {
      error = caught;
    }
    const next = outcome(error, delivery.attempts);
    if (error) console.warn(`[webhook] ${url} (${delivery.event.type}): ${next.lastError}`);
    await db.update(webhookDeliveries).set(next).where(eq(webhookDeliveries.id, delivery.id));
    count(tally, next.state);
  });
}

/** Sends up to `limit` of each that is due. */
export async function drain({ limit }: { limit: number }): Promise<Tally> {
  const tally: Tally = { sent: 0, failed: 0, retried: 0 };
  await Promise.all([drainNotifications(limit, tally), drainWebhooks(limit, tally)]);
  return tally;
}
