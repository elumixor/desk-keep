import { authed } from "~/lib/http/authed";
import { personById } from "~/lib/people-api/directory";

/** The name and avatar a person value renders with. */
export default authed(({ router }) => personById(router.id));
