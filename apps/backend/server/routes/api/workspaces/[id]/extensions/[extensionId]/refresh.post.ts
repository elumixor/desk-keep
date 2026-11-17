import { refreshExtension } from "~/lib/extensions/extensions";
import { authed } from "~/lib/http/authed";

/** Fetches the manifest again now, rather than within the hour. */
export default authed(({ caller, router }) => refreshExtension(caller, router.id, router.extensionId));
