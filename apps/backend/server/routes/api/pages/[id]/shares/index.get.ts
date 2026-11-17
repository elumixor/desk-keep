import { authed } from "~/lib/http/authed";
import { listShares } from "~/lib/shares";

export default authed(({ caller, router }) => listShares(caller, router.id));
