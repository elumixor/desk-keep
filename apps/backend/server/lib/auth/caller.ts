import { verifyToken } from "@clerk/backend";
import { and, eq, isNull } from "drizzle-orm";
import { getCookie, type H3Event } from "h3";
import { db } from "~/db";
import { people } from "~/db/schema";
import { env } from "~/lib/env";
import { ApiError, NotAuthenticatedError } from "~/lib/http/api-error";
import { linked } from "~/lib/people-api/accounts";
import { provisionPerson } from "./provision";
import { findToken, TOKEN_PREFIX } from "./tokens";

export type Person = typeof people.$inferSelect;
/** An account linked to its People person, as every caller's is. */
export type Account = Person & { readonly peopleId: string };

/**
 * Who is making a request: an account (signed in, or with its key; an assistant like Pai is one too), and the opaque
 * tag of the client it writes through (`x-keep-client`, or an MCP tool's `client`), null when it sent none.
 */
export type Caller = { readonly person: Account; readonly client: string | null };

/** What a client tag may be: short, printable, no spaces (`pai:thread/<id>`). */
export const CLIENT_TAG = /^[A-Za-z0-9._:/-]{1,200}$/;

/** The People id written as an author (`page.created_by`, `comment.author_id`, `page_version.author_id`). */
export const authorId = (caller: Caller) => caller.person.peopleId;
/** The Keep account id: memberships, keys, the sync mutation log. */
export const accountId = (caller: Caller) => caller.person.id;

/** The same caller writing through another client; `undefined` keeps the one it came with. */
export const withClient = (caller: Caller, client?: string | null): Caller =>
  client === undefined ? caller : { ...caller, client };

const BEARER = /^Bearer (.+)$/;
/** Clerk's session cookie, which is what an embed or an element on another subdomain arrives with. */
const SESSION_COOKIE = "__session";

function credential(event: H3Event) {
  const header = event.headers.get("authorization");
  return header?.match(BEARER)?.[1] ?? getCookie(event, SESSION_COOKIE) ?? null;
}

function clientOf(event: H3Event) {
  const client = event.headers.get("x-keep-client");
  if (client === null || client === "") return null;
  if (!CLIENT_TAG.test(client)) throw new ApiError("x-keep-client must be 1–200 of A–Z a–z 0–9 . _ : / -");
  return client;
}

async function fromToken(secret: string): Promise<Account> {
  const token = await findToken(secret);
  const person = token && (await db.query.people.findFirst({ where: eq(people.id, token.personId) }));
  if (!person) throw new NotAuthenticatedError("This key is not valid");
  return linked(person);
}

async function fromSession(sessionToken: string): Promise<Account> {
  let userId: string;
  try {
    ({ sub: userId } = await verifyToken(sessionToken, { secretKey: env.CLERK_SECRET_KEY }));
  } catch {
    throw new NotAuthenticatedError("Your session has expired");
  }
  return provisionPerson(userId);
}

/** An invite stops being pending the first time its account signs in or uses a key. */
async function joined(account: Account): Promise<Account> {
  if (account.joinedAt) return account;
  const joinedAt = new Date();
  await db
    .update(people)
    .set({ joinedAt })
    .where(and(eq(people.id, account.id), isNull(people.joinedAt)));
  return { ...account, joinedAt };
}

export async function resolveCaller(event: H3Event): Promise<Caller> {
  const secret = credential(event);
  if (!secret) throw new NotAuthenticatedError();
  const client = clientOf(event);
  const person = await joined(await (secret.startsWith(TOKEN_PREFIX) ? fromToken(secret) : fromSession(secret)));
  return { person, client };
}
