import { authed } from "~/lib/http/authed";
import { fields } from "~/lib/http/schemas";
import { changeRole } from "~/lib/workspaces/members";

export default authed({ body: { role: fields.role } }, ({ caller, router, body }) =>
  changeRole(caller, router.id, router.personId, body.role),
);
