import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { createWebhook } from "~/lib/workspaces/webhooks";

export default authed({ body: { url: fields.url, events: fields.events } }, ({ caller, router, body }) =>
  createWebhook(caller, router.id, body.url, body.events),
);
