import { authed } from "~/lib/http/authed";
import { listWebhooks } from "~/lib/workspaces/webhooks";

export default authed(({ caller, router }) => listWebhooks(caller, router.id));
