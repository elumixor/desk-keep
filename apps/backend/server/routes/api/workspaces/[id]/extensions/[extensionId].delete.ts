import { removeExtension } from "~/lib/extensions/extensions";
import { authed } from "~/lib/http/authed";

export default authed(({ caller, router }) => removeExtension(caller, router.id, router.extensionId));
