import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { memberships, people, type Role, syncRevocations } from "~/db/schema";
import type { Caller, Person } from "../auth/caller";
import { ApiError, NotFoundError } from "../http/api-error";
import { transact } from "../notify/outbox";
import { authorizeWorkspace } from "../permissions";
import { type Invitee, personView, resolveInvitee, revokeSync } from "../shares";

const membershipOf = (workspaceId: string, personId: string) =>
  and(eq(memberships.workspaceId, workspaceId), eq(memberships.personId, personId));

/** A workspace answers to somebody who signs in. An account that only works with a key, an assistant like Pai, never owns one; a pending invite may still sign in. */
export function assertCanOwn(person: Pick<Person, "userId" | "joinedAt">) {
  if (!person.userId && person.joinedAt) throw new ApiError("Only someone who signs in can own a workspace", 403);
}

/** A workspace's members, pending invites among them; emails only for members, not for visitors with shares. */
export async function listMembers(caller: Caller, workspaceId: string) {
  const access = await authorizeWorkspace(caller, workspaceId, "read", { visitor: true });
  const rows = await db
    .select({
      person: people,
      role: memberships.role,
      invitedAt: memberships.invitedAt,
      invitedBy: memberships.invitedBy,
    })
    .from(memberships)
    .innerJoin(people, eq(people.id, memberships.personId))
    .where(eq(memberships.workspaceId, workspaceId));
  const member = access !== "view";
  return rows.map(({ person, role, invitedAt, invitedBy }) => ({
    ...personView(person, member),
    role,
    hasAccount: person.userId !== null,
    invitedAt: invitedAt.toISOString(),
    invitedBy,
  }));
}

/**
 * Adds somebody: a People person, or an email People finds or writes down. Somebody who has never signed in gets an
 * account that stays pending until their first sign-in claims it (`provisionPerson`).
 */
export async function invite(caller: Caller, workspaceId: string, invitee: Invitee, role: Role) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  const person = await resolveInvitee(invitee);
  if (role === "owner") assertCanOwn(person);
  // Inviting somebody already in changes their role: the workspace still keeps an owner.
  const existing = await db.query.memberships.findFirst({ where: membershipOf(workspaceId, person.id) });
  if (existing && existing.role !== role) await checkOwners(workspaceId, person.id, role);
  const membership = await transact(caller, async (tx, out) => {
    const [row] = await tx
      .insert(memberships)
      .values({ personId: person.id, workspaceId, role, invitedBy: caller.person.id })
      .onConflictDoUpdate({
        target: [memberships.personId, memberships.workspaceId],
        set: { role },
      })
      .returning({ created: sql<boolean>`xmax = 0` });
    if (row.created) out.notify({ type: "invite", to: person.peopleId, pageId: workspaceId, role, trusted: true });
    await tx
      .delete(syncRevocations)
      .where(and(eq(syncRevocations.personId, person.id), eq(syncRevocations.pageId, workspaceId)));
    return row;
  });
  return { ...personView(person, true), role, created: membership.created };
}

/** Sends a pending invite again: only to somebody who has not signed in yet. */
export async function resendInvite(caller: Caller, workspaceId: string, personId: string) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  const [row] = z.uuid().safeParse(personId).success
    ? await db
        .select({ person: people, role: memberships.role })
        .from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId))
        .where(membershipOf(workspaceId, personId))
    : [];
  if (!row) throw new NotFoundError("Member");
  if (row.person.joinedAt) throw new ApiError("They have already joined", 409);
  const to = row.person.peopleId;
  // Again, under a new notification id: People sends the invite again.
  if (to)
    await transact(caller, async (_tx, out) =>
      out.notify({ type: "invite", to, pageId: workspaceId, role: row.role, trusted: true }),
    );
  return { ...personView(row.person, true), role: row.role };
}

/** Checks a member may stop being an owner (to `role`, or by leaving): a workspace keeps at least one. */
async function checkOwners(workspaceId: string, personId: string, role?: Role) {
  const current = await db.query.memberships.findFirst({ where: membershipOf(workspaceId, personId) });
  if (!current) throw new NotFoundError("Member");
  if (current.role !== "owner" || role === "owner") return;
  const owners = await db.query.memberships.findMany({
    where: and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")),
  });
  if (owners.length === 1) throw new ApiError("A workspace needs at least one owner");
}

export async function changeRole(caller: Caller, workspaceId: string, personId: string, role: Role) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  await checkOwners(workspaceId, personId, role);
  if (role === "owner") {
    const person = await db.query.people.findFirst({ where: eq(people.id, personId) });
    if (!person) throw new NotFoundError("Member");
    assertCanOwn(person);
  }
  await db.update(memberships).set({ role }).where(membershipOf(workspaceId, personId));
  return { personId, role };
}

export async function removeMember(caller: Caller, workspaceId: string, personId: string) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  await checkOwners(workspaceId, personId);
  await db.transaction(async (tx) => {
    await tx.delete(memberships).where(membershipOf(workspaceId, personId));
    await revokeSync(tx, personId, workspaceId, workspaceId);
  });
  return { personId };
}
