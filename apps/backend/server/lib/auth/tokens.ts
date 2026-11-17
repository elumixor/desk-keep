import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { tokens } from "~/db/schema";

/** Every API key starts with this, so a key is told apart from a Clerk session token without trying it. */
export const TOKEN_PREFIX = "keep_";
const SECRET_BYTES = 32;

const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** The account a key acts as. */
type TokenOwner = { readonly personId: string };

/** Mints a key and returns its secret, which is shown once and never stored. */
export async function mintToken(owner: TokenOwner, name: string) {
  const secret = `${TOKEN_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
  const [row] = await db
    .insert(tokens)
    .values({ hash: hash(secret), name, ...owner })
    .returning({ id: tokens.id, name: tokens.name, createdAt: tokens.createdAt });
  return { ...row, secret };
}

const LAST_USED_EVERY_MS = 60 * 60_000;

export async function findToken(secret: string) {
  const row = await db.query.tokens.findFirst({ where: eq(tokens.hash, hash(secret)) });
  // An hour is as close as anyone reads "last used": a write on every call was most of the database's writes.
  if (row && (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS))
    await db.update(tokens).set({ lastUsedAt: new Date() }).where(eq(tokens.id, row.id));
  return row ?? null;
}
