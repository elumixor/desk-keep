import { authed } from "~/lib/http/authed";
import { listTraits } from "~/lib/traits";

export default authed(({ caller, router }) => listTraits(caller, router.id));
