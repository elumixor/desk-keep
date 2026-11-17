import { authed } from "~/lib/http/authed";
import { getVersion } from "~/lib/pages/versions";

export default authed(({ caller, router }) => getVersion(caller, router.id, router.versionId));
