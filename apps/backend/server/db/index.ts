import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/lib/env";
import * as schema from "./schema";

// Postgres runs on the same box, so connections are cheap and statements are prepared. `fetch_types: false` skips the
// type catalogue query each connection otherwise makes; the uuid[] parser it would have found is given here instead.
const UUID_ARRAY = 2951;
const TEXT_ARRAY = 1009;

/** A one-dimensional array literal (`{a,"b c",NULL}`) as strings: all this database returns are uuid[] and text[]. */
function parseArray(literal: string): (string | null)[] {
  const out: (string | null)[] = [];
  const body = literal.slice(1, -1);
  let i = 0;
  while (i < body.length) {
    if (body[i] === '"') {
      let value = "";
      for (i++; i < body.length && body[i] !== '"'; i++) value += body[i] === "\\" ? body[++i] : body[i];
      out.push(value);
      i += 2;
    } else {
      const end = body.indexOf(",", i);
      const value = body.slice(i, end === -1 ? body.length : end);
      out.push(value === "NULL" ? null : value);
      i = end === -1 ? body.length : end + 1;
    }
  }
  return out;
}

const arrayType = (oid: number) => ({ to: oid, from: [oid], serialize: (v: unknown) => v, parse: parseArray });

const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 60,
  fetch_types: false,
  types: { uuidArray: arrayType(UUID_ARRAY), textArray: arrayType(TEXT_ARRAY) },
});

export const db = drizzle(client, { schema, casing: "snake_case" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
