import { listExtensions } from "~/lib/extensions/extensions";
import { authed } from "~/lib/http/authed";

export default authed(({ caller, router }) => listExtensions(caller, router.id));
