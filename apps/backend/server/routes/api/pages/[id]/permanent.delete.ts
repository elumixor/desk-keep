import { authed } from "~/lib/http/authed";
import { purgePage } from "~/lib/pages/purge";

export default authed(({ caller, router }) => purgePage(caller, router.id));
