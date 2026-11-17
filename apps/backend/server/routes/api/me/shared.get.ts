import { authed } from "~/lib/http/authed";
import { sharedWithMe } from "~/lib/shares";

/** The pages shared with the caller, and whether they are a member of each one's workspace anyway. */
export default authed(({ caller }) => sharedWithMe(caller));
