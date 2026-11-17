import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { movePage } from "~/lib/pages/write";

/** `beforeId` is the sibling the page lands in front of; without one it goes last. */
export default authed(
  { body: { parentId: fields.id, beforeId: fields.id.nullable().optional() } },
  ({ caller, router, body }) => movePage(caller, router.id, body.parentId, { beforeId: body.beforeId ?? null }),
);
