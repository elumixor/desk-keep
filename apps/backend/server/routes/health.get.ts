import { sql } from "drizzle-orm";
import { defineEventHandler, setResponseStatus } from "h3";
import { db } from "~/db";

const UNAVAILABLE = 503;

/** Up when the database answers: what a release waits on before it calls itself done. */
export default defineEventHandler(async (event) => {
  try {
    await db.execute(sql`select 1`);
    return { ok: true };
  } catch {
    setResponseStatus(event, UNAVAILABLE);
    return { ok: false };
  }
});
