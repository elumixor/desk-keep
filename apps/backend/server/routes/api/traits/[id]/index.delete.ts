import { authed } from "~/lib/http/authed";
import { deleteTrait } from "~/lib/traits";

export default authed(({ caller, router }) => deleteTrait(caller, router.id));
