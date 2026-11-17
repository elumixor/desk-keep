import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { changeShare } from "~/lib/shares";
import { SHARE_ROLES } from "~/model/access";

export default authed({ body: { role: z.enum(SHARE_ROLES) } }, ({ caller, router, body }) =>
  changeShare(caller, router.id, router.shareId, body.role),
);
