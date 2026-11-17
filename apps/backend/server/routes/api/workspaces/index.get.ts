import { authed } from "~/lib/http/authed";
import { myWorkspaces } from "~/lib/pages/read";

export default authed(({ caller }) => myWorkspaces(caller));
