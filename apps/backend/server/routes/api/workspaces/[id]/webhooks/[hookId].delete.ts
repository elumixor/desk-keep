import { authed } from "~/lib/http/authed";
import { deleteWebhook } from "~/lib/workspaces/webhooks";

export default authed(({ caller, router }) => deleteWebhook(caller, router.id, router.hookId));
