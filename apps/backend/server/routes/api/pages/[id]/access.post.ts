import { z } from "zod";
import { readersAmong } from "~/lib/access";
import { authed } from "~/lib/http/authed";
import { authorizePage } from "~/lib/permissions";

/** For who may comment (and so mention): which of some People persons may read the page (`readers`) and which may not (`hidden`): before naming them on it. */
export default authed({ body: { people: z.array(z.uuid()).min(1).max(50) } }, async ({ caller, router, body }) => {
  await authorizePage(caller, router.id, "comment");
  const readers = await readersAmong(router.id, body.people);
  return { readers: [...readers], hidden: body.people.filter((id) => !readers.has(id)) };
});
