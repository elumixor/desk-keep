import { authed } from "~/lib/http/authed";
import { queryView } from "~/lib/views";

export default authed(({ caller, router }) => queryView(caller, router.id));
