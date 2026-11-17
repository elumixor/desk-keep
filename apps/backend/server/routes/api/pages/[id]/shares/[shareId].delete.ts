import { authed } from "~/lib/http/authed";
import { revokeShare } from "~/lib/shares";

export default authed(({ caller, router }) => revokeShare(caller, router.id, router.shareId));
