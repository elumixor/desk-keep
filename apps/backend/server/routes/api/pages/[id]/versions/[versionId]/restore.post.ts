import { authed } from "~/lib/http/authed";
import { restoreVersion } from "~/lib/pages/versions";

export default authed(({ caller, router }) => restoreVersion(caller, router.id, router.versionId));
