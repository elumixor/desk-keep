import { authed } from "~/lib/http/authed";
import { trash } from "~/lib/pages/read";

export default authed(({ caller, router }) => trash(caller, router.id));
