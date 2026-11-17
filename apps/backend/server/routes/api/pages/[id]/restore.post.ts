import { authed } from "~/lib/http/authed";
import { restorePage } from "~/lib/pages/write";

export default authed(({ caller, router }) => restorePage(caller, router.id));
