import { authed } from "~/lib/http/authed";
import { personUrn } from "~/model/urn";

/** The caller's account (`id`) and its People person (`peopleId`, `urn`), which authors and person values name. */
export default authed(({ caller: { person } }) => ({
  id: person.id,
  peopleId: person.peopleId,
  urn: personUrn(person.peopleId),
  name: person.name,
  email: person.email,
  avatar: person.avatar,
}));
