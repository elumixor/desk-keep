import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { addPerson } from "~/lib/people-api/directory";

/** Writes a new person down in People, from a picker. */
export default authed({ body: { name: z.string().trim().min(1).max(200) } }, ({ body }) => addPerson(body.name));
