import { authed } from "~/lib/http/authed";
import { pageWatchers } from "~/lib/notify/watch";

export default authed(({ caller, router }) => pageWatchers(caller, router.id));
