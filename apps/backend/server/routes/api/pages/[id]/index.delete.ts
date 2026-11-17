import { authed } from "~/lib/http/authed";
import { deletePage } from "~/lib/pages/write";

export default authed(({ caller, router }) => deletePage(caller, router.id));
