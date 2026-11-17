import { authed } from "~/lib/http/authed";
import { liveChanges } from "~/lib/sync";

/** A nudge whenever something changes in the caller's workspaces (`lib/sync.ts`). */
export default authed(async function* ({ caller, signal }) {
  yield* liveChanges(caller, signal);
});
