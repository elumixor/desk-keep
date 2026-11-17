import { authed } from "~/lib/http/authed";
import { removeEmoji } from "~/lib/workspaces/emoji";

export default authed(({ caller, router }) => removeEmoji(caller, router.id, router.emojiId));
