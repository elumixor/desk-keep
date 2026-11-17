import { authed } from "~/lib/http/authed";
import { resendInvite } from "~/lib/workspaces/members";

export default authed(({ caller, router }) => resendInvite(caller, router.id, router.personId));
