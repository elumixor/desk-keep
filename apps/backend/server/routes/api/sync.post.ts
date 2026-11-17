import { mutationSchema, sinceSchema } from "@elumixor/synced/server";
import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { sync } from "~/lib/sync";

/** The app's writes and reads in one round trip (`lib/sync.ts`). */
export default authed({ body: { since: sinceSchema, mutations: z.array(mutationSchema) } }, ({ caller, body }) =>
  sync(caller, body),
);
