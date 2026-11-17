import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "~/db";
import { people } from "~/db/schema";
import { hasMembershipOrShare } from "~/lib/access";
import { linked } from "~/lib/people-api/accounts";
import { peopleApi } from "~/lib/people-api/client";
import { createWorkspace } from "~/lib/workspaces/create";
import type { Account } from "./caller";
import { clerk } from "./clerk";

/** The person a Clerk user is in People: claimed there by any of their verified emails, else as People finds them. */
async function peoplePerson(userId: string, account: { email: string | null; name: string; avatar: string | null }) {
  try {
    return await peopleApi.claim(userId);
  } catch (error) {
    console.warn("People claim failed; finding the person instead", error);
    return peopleApi.ensure({ userId, ...account });
  }
}

/**
 * The account behind a Clerk user, made on first sign-in. Somebody invited before they had one (by People person or
 * by any of their emails) already has an account; signing in claims it. Whoever belongs nowhere yet (no membership,
 * no share) gets a workspace of their own.
 */
export async function provisionPerson(userId: string): Promise<Account> {
  const existing = await db.query.people.findFirst({ where: eq(people.userId, userId) });
  if (existing) return linked(existing);

  const user = await clerk.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;
  const emails = user.emailAddresses
    .filter((e) => e.verification?.status === "verified")
    .map((e) => e.emailAddress.toLowerCase());
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || email?.split("@")[0] || "Someone";
  const avatar = user.hasImage ? user.imageUrl : null;
  const person = await peoplePerson(userId, { email, name, avatar });
  const joinedAt = new Date();

  // Invited as this People person, or (before accounts were linked) by one of their emails.
  const [claimed] = await db
    .update(people)
    .set({ userId, avatar, joinedAt })
    .where(and(eq(people.peopleId, person.id), isNull(people.userId)))
    .returning();
  const invited =
    claimed || !emails.length
      ? undefined
      : await db.query.people.findFirst({
          where: and(isNull(people.userId), isNull(people.peopleId), inArray(people.email, emails)),
        });
  const [legacy] = invited
    ? await db
        .update(people)
        .set({ userId, avatar, joinedAt, peopleId: person.id })
        .where(and(eq(people.id, invited.id), isNull(people.userId)))
        .returning()
    : [];
  let account = claimed ?? legacy;
  if (!account) {
    const [made] = await db
      .insert(people)
      .values({ userId, peopleId: person.id, email, name, avatar, joinedAt })
      .onConflictDoNothing()
      .returning();
    // Two first requests at once: the other one made the row.
    account = made ?? (await db.query.people.findFirst({ where: eq(people.userId, userId) }));
    if (!account) throw new Error(`Person for ${userId} was neither inserted nor found`);
    if (!made) return linked(account);
  }
  // Linked before the workspace, whose root names its creator by People id.
  const ready = await linked(account);
  if (!(await hasMembershipOrShare(ready.id))) await createWorkspace(ready, `${name.split(" ")[0]}'s workspace`);
  return ready;
}
