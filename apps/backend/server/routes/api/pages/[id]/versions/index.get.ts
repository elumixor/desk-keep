import { authed } from "~/lib/http/authed";
import { listVersions } from "~/lib/pages/versions";

export default authed(({ caller, router }) => listVersions(caller, router.id));
