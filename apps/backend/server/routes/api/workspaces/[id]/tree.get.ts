import { authed } from "~/lib/http/authed";
import { workspaceTree } from "~/lib/pages/read";

export default authed(({ caller, router }) => workspaceTree(caller, router.id));
