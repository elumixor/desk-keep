import { authed } from "~/lib/http/authed";
import { deleteView } from "~/lib/views";

export default authed(({ caller, router }) => deleteView(caller, router.id));
