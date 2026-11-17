import { eq } from "drizzle-orm";
import { db } from "~/db";
import { people } from "~/db/schema";
import type { Account, Person } from "../auth/caller";
import { peopleApi } from "./client";

/** An account with its person in People: looked up or made there the first time, and kept as `peopleId`. */
export async function linkPeople(person: Person): Promise<Person> {
  if (person.peopleId) return person;
  const found = await peopleApi.ensure(person);
  const [linked] = await db.update(people).set({ peopleId: found.id }).where(eq(people.id, person.id)).returning();
  return linked;
}

/** `person` as an `Account`, linked to People first when it is not yet. */
export async function linked(person: Person): Promise<Account> {
  const { peopleId, ...account } = await linkPeople(person);
  if (!peopleId) throw new Error(`Account ${person.id} could not be linked to People`);
  return { ...account, peopleId };
}
