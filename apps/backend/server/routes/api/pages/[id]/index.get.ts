import { authed } from "~/lib/http/authed";
import { getPage } from "~/lib/pages/read";

export default authed(({ caller, router }) => getPage(caller, router.id));
