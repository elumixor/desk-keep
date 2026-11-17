import { authed } from "~/lib/http/authed";
import { listMembers } from "~/lib/workspaces/members";

export default authed(({ caller, router }) => listMembers(caller, router.id));
