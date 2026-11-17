import { defineNitroPlugin } from "nitropack/runtime";
import { runCleanup } from "~/lib/cleanup";
import { drain } from "~/lib/notify/deliver";
import { purgeExpiredTrash } from "~/lib/pages/purge";
import { sealWebhookSecrets } from "~/lib/webhooks/backfill";

const DRAIN_EVERY_MS = 15_000;
const PURGE_EVERY_MS = 60 * 60_000;
const CLEANUP_EVERY_MS = 24 * 60 * 60_000;

/**
 * The server (the box, local dev) is its own scheduler: the outbox is drained (and old webhook secrets
 * sealed) every few seconds, the trash emptied every hour and views' cleanup rules run every day (`lib/cleanup.ts`),
 * both once at start too, as restarts come more often than days.
 */
export default defineNitroPlugin(() => {
  const tick = async () => {
    await sealWebhookSecrets();
    await drain({ limit: 200 });
  };
  // A dropped connection is retried on the next tick: one line, not the query and its stack.
  const failed = (job: string) => (error: Error & { cause?: { code?: string } }) =>
    console.warn(`[${job}] failed, retrying later: ${error.cause?.code ?? error.message}`);
  const purge = () => void purgeExpiredTrash().catch(failed("purge"));
  setInterval(() => void tick().catch(failed("outbox")), DRAIN_EVERY_MS);
  const cleanup = () =>
    void runCleanup()
      .then(({ archived }) => archived && console.log(`[cleanup] archived ${archived} pages`))
      .catch(failed("cleanup"));
  setInterval(purge, PURGE_EVERY_MS);
  setInterval(cleanup, CLEANUP_EVERY_MS);
  purge();
  cleanup();
});
