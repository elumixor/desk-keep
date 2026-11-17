import { authed } from "~/lib/http/authed";
import { removeMember } from "~/lib/workspaces/members";

export default authed(({ caller, router }) => removeMember(caller, router.id, router.personId));
