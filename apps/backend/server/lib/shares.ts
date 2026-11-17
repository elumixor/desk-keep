import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "~/db";
import { pageShares, pages, people, syncRevocations } from "~/db/schema";
import { ACCESS, abilities, may, type ShareRole } from "~/model/access";
import { pageUrl, personIdOf } from "~/model/urn";
import { accessFor, sharersAbove } from "./access";
import type { Account, Caller, Person } from "./auth/caller";
import { ApiError, NotFoundError } from "./http/api-error";
import { transact } from "./notify/outbox";
import { ancestorsOf } from "./pages/read";
import { below, subtree } from "./pages/subtree";
import { linked } from "./people-api/accounts";
import { peopleApi } from "./people-api/client";
import { authorizedPage, type Page } from "./permissions";

/** Who a share or an invite is for: a People person (id or People address), or an email People finds or adds. */
export type Invitee = { readonly person: string } | { readonly email: string; readonly name?: string };

/** The account a People person has in Keep, made (pending, never signed in) when they have none yet. */
async function accountFor(peopleId: string, seed: { name: string; email: string | null }): Promise<Account> {
  const existing = await db.query.people.findFirst({ where: eq(people.peopleId, peopleId) });
  if (existing) return linked(existing);
  const [made] = await db
    .insert(people)
    .values({ peopleId, name: seed.name, email: seed.email })
    .onConflictDoNothing()
    .returning();
  // Two invites at once: the other one made the row.
  const account = made ?? (await db.query.people.findFirst({ where: eq(people.peopleId, peopleId) }));
  if (!account) throw new Error(`Account for People person ${peopleId} was neither inserted nor found`);
  return linked(account);
}

/** The account an invitee is: found by People id, or by email through People (`ensure`), made when there is none. */
export async function resolveInvitee(invitee: Invitee): Promise<Account> {
  if ("person" in invitee) {
    const id = personIdOf(invitee.person) ?? (z.uuid().safeParse(invitee.person).success ? invitee.person : null);
    if (!id) throw new ApiError(`Not a People person id or URN: ${invitee.person}`);
    const known = await db.query.people.findFirst({ where: eq(people.peopleId, id) });
    if (known) return linked(known);
    const found = await peopleApi.get(id);
    if (!found) throw new ApiError(`People has no person ${id}`);
    return accountFor(found.id, { name: found.name, email: found.emails[0] ?? null });
  }
  const email = invitee.email.trim().toLowerCase();
  const found = await peopleApi.ensureByEmail(email, invitee.name);
  const known = await db.query.people.findFirst({ where: eq(people.peopleId, found.id) });
  if (known) return linked(known);
  // An account invited by email before accounts were linked to People: it is this person.
  const legacy = await db.query.people.findFirst({ where: and(eq(people.email, email), isNull(people.peopleId)) });
  if (legacy) {
    const [claimed] = await db.update(people).set({ peopleId: found.id }).where(eq(people.id, legacy.id)).returning();
    return linked(claimed);
  }
  return accountFor(found.id, { name: invitee.name || found.name, email });
}

/** A person as a share or member list shows them; the email only to whoever may share or run the workspace. */
export const personView = (person: Person, withEmail: boolean) => ({
  id: person.id,
  peopleId: person.peopleId,
  name: person.name,
  email: withEmail ? person.email : null,
  avatar: person.avatar,
  /** Invited and never signed in nor used a key. */
  pending: person.joinedAt === null,
});

/** The person a share names, else a share the caller may not see. */
async function directShare(pageId: string, shareId: string) {
  const share = z.uuid().safeParse(shareId).success
    ? await db.query.pageShares.findFirst({ where: and(eq(pageShares.id, shareId), eq(pageShares.pageId, pageId)) })
    : undefined;
  if (!share) throw new NotFoundError("Share");
  return share;
}

/**
 * Who a page is shared with: its own shares, and its ancestors' (inherited, read-only here, with the page they come
 * from). Anyone who can read the page sees the list; emails only who may share it.
 */
export async function listShares(caller: Caller, pageId: string) {
  const { page, access } = await authorizedPage(caller, pageId, "read");
  const chain = [...(await ancestorsOf(page.id)), { id: page.id, title: page.title, icon: page.icon }];
  const rows = await db
    .select({ share: pageShares, person: people })
    .from(pageShares)
    .innerJoin(people, eq(people.id, pageShares.personId))
    .where(
      inArray(
        pageShares.pageId,
        chain.map((p) => p.id),
      ),
    )
    .orderBy(asc(pageShares.invitedAt));
  const depth = new Map(chain.map((p, i) => [p.id, i]));
  const withEmail = may(access, "share");
  return {
    access,
    can: abilities(access),
    shares: rows
      .sort((a, b) => (depth.get(b.share.pageId) ?? 0) - (depth.get(a.share.pageId) ?? 0))
      .map(({ share, person }) => {
        const from = chain.find((p) => p.id === share.pageId);
        const inherited = share.pageId !== page.id;
        return {
          id: share.id,
          pageId: share.pageId,
          inherited,
          from: inherited && from ? { id: from.id, title: from.title, icon: from.icon } : null,
          role: share.role,
          person: personView(person, withEmail),
          invitedBy: share.invitedBy,
          invitedAt: share.invitedAt.toISOString(),
        };
      }),
  };
}

/**
 * Shares a page, and everything under it, with somebody as `role` (or changes the role they have on it): they find it
 * under "Shared with me" and their devices pull the subtree. Needs `share` (full access) on the page.
 */
export async function sharePage(caller: Caller, pageId: string, invitee: Invitee, role: ShareRole) {
  const { page } = await authorizedPage(caller, pageId, "share");
  if (page.deletedAt) throw new ApiError("That page is in the trash");
  const account = await resolveInvitee(invitee);
  if (account.id === caller.person.id) throw new ApiError("You already have this page");
  const workspaceId = page.workspaceId ?? page.id;
  const share = await transact(caller, async (tx, out) => {
    const [row] = await tx
      .insert(pageShares)
      .values({ pageId: page.id, workspaceId, personId: account.id, role, invitedBy: caller.person.id })
      .onConflictDoUpdate({ target: [pageShares.pageId, pageShares.personId], set: { role } })
      .returning({ id: pageShares.id, role: pageShares.role, created: sql<boolean>`xmax = 0` });
    await tx
      .delete(syncRevocations)
      .where(and(eq(syncRevocations.personId, account.id), eq(syncRevocations.pageId, page.id)));
    if (row.created) out.notify({ type: "share", to: account.peopleId, pageId: page.id, role, trusted: true });
    return row;
  });
  return {
    id: share.id,
    pageId: page.id,
    role: share.role,
    /** A new share, rather than a role changed. */
    created: share.created,
    person: personView(account, true),
  };
}

/** A share's role changed, by whoever may share the page. */
export async function changeShare(caller: Caller, pageId: string, shareId: string, role: ShareRole) {
  await authorizedPage(caller, pageId, "share");
  await directShare(pageId, shareId);
  const [row] = await db.update(pageShares).set({ role }).where(eq(pageShares.id, shareId)).returning();
  return { id: row.id, pageId, role: row.role };
}

/** Marks a subtree as no longer held by an account: its devices drop whatever of it they can no longer read. */
export async function revokeSync(q: typeof db | Tx, personId: string, pageId: string, workspaceId: string) {
  await q
    .insert(syncRevocations)
    .values({ personId, pageId, workspaceId })
    .onConflictDoUpdate({ target: [syncRevocations.personId, syncRevocations.pageId], set: { workspaceId } });
}

/** Takes a share back; whoever it was for may also leave it, unless it narrows what they have from above. The page leaves their devices on their next sync. */
export async function revokeShare(caller: Caller, pageId: string, shareId: string) {
  const share = await directShare(pageId, shareId);
  // Leaving a share that narrows what one has from above would widen it: that takes whoever may share the page.
  const leaving =
    share.personId === caller.person.id &&
    ACCESS.indexOf(await accessFor(db, caller.person.id, pageId, share.id)) <= ACCESS.indexOf(share.role);
  await authorizedPage(caller, pageId, leaving ? "read" : "share");
  await db.transaction(async (tx) => {
    await tx.delete(pageShares).where(eq(pageShares.id, share.id));
    await revokeSync(tx, share.personId, share.pageId, share.workspaceId);
  });
  return { id: share.id };
}

/** The pages shared with the caller (not in the trash), newest first, and whether they are a member there anyway. */
export async function sharedWithMe(caller: Caller) {
  const workspace = sql<string>`(select w.title from page w where w.id = "page_share"."workspace_id")`;
  const workspaceIcon = sql<string | null>`(select w.icon from page w where w.id = "page_share"."workspace_id")`;
  const sharedBy = sql<string | null>`(select a.people_id from person a where a.id = "page_share"."invited_by")`;
  const member = sql<boolean>`exists (select 1 from membership m where m.person_id = "page_share"."person_id" and m.workspace_id = "page_share"."workspace_id")`;
  const rows = await db
    .select({
      pageId: pageShares.pageId,
      workspaceId: pageShares.workspaceId,
      workspaceTitle: workspace,
      workspaceIcon,
      title: pages.title,
      icon: pages.icon,
      kind: pages.kind,
      role: pageShares.role,
      member,
      sharedBy,
      sharedAt: pageShares.invitedAt,
    })
    .from(pageShares)
    .innerJoin(pages, eq(pages.id, pageShares.pageId))
    .where(and(eq(pageShares.personId, caller.person.id), isNull(pages.deletedAt)))
    .orderBy(desc(pageShares.invitedAt));
  return rows.map(({ workspaceTitle, workspaceIcon, sharedAt, ...row }) => ({
    ...row,
    url: pageUrl(row.pageId),
    workspace: { id: row.workspaceId, title: workspaceTitle, icon: workspaceIcon },
    sharedAt: sharedAt.toISOString(),
  }));
}

/** The pages shared with the caller in workspaces they are no member of: "Shared with me". */
export const sharedOnly = async (caller: Caller) => (await sharedWithMe(caller)).filter((s) => !s.member);

/** Before a page moves to another parent: who holds it through a share above it, and may lose it. */
export const beforeMove = (tx: Tx, pageId: string) => sharersAbove(tx, pageId);

/**
 * After a page moved: whoever held it through a share it left has it taken off their devices (unless a share above its
 * new place gives it back), and when shares now reach it, its subtree is stamped again so their next pull carries it.
 */
export async function afterMove(tx: Tx, page: Page, before: readonly string[]) {
  const workspaceId = page.workspaceId ?? page.id;
  for (const personId of before) await revokeSync(tx, personId, page.id, workspaceId);
  const now = await sharersAbove(tx, page.id);
  if (!now.some((id) => !before.includes(id))) return;
  await tx.execute(sql`update page set sort = sort where id in (${below(page.id)})`);
  await tx.execute(sql`update comment set body = body where page_id in (${subtree(page.id)})`);
  await tx.execute(sql`update view set kind = kind where id in (${subtree(page.id)})`);
}
