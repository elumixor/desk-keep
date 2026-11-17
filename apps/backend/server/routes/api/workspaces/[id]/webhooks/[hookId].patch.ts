import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { updateWebhook } from "~/lib/workspaces/webhooks";

export default authed({ body: { events: fields.events } }, ({ caller, router, body }) =>
  updateWebhook(caller, router.id, router.hookId, body.events),
);
