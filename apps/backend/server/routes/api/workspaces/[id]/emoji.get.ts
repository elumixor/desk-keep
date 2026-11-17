import { authed } from "~/lib/http/authed";
import { listEmoji } from "~/lib/workspaces/emoji";

export default authed(({ caller, router }) => listEmoji(caller, router.id));
