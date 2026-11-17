import { eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "~/db";
import { pages, pageVersions, people } from "~/db/schema";
import { env } from "~/lib/env";
import type { PropertyValues } from "~/model/properties";
import { linkPeople } from "./accounts";
import { peopleApi } from "./client";

/** A person property's value as stored: `{kind, id}` entries (`kind: "agent"` only until agents are retired). */
type Named = { readonly kind: string; readonly id: string };

const isNamedList = (value: unknown): value is readonly Named[] =>
  Array.isArray(value) && value.every((v) => typeof v === "object" && v !== null && "kind" in v && "id" in v);

/** `values` with each named entry `swap` gives a People id for written as that person, no duplicates; null when none did. */
function remap(values: PropertyValues, swap: (entry: Named) => string | undefined) {
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (!isNamedList(value)) return [key, value];
      const seen = new Set<string>();
      const list: Named[] = [];
      for (const entry of value) {
        const peopleId = swap(entry);
        if (peopleId) changed = true;
        const named = peopleId ? { kind: "person", id: peopleId } : entry;
        const seenAs = `${named.kind}:${named.id}`;
        if (!seen.has(seenAs)) list.push(named);
        seen.add(seenAs);
      }
      return [key, list];
    }),
  ) as PropertyValues;
  return changed ? next : null;
}

/** Rewrites the person values of pages and their versions (whose text matches `like`) with `swap`; counts the rows. */
async function remapValues(tx: Tx | typeof db, like: string, swap: (entry: Named) => string | undefined) {
  const counts = { pages: 0, versions: 0 };
  for (const [table, count] of [
    [pages, "pages"],
    [pageVersions, "versions"],
  ] as const) {
    const rows = await tx
      .select({ id: table.id, properties: table.properties })
      .from(table)
      .where(sql`${table.properties}::text like ${like}`);
    for (const row of rows) {
      const next = remap(row.properties, swap);
      if (!next) continue;
      await tx.update(table).set({ properties: next }).where(eq(table.id, row.id));
      counts[count] += 1;
    }
  }
  return counts;
}

const rows = (result: unknown) => (result as { count?: number }).count ?? 0;

/**
 * Agents are retired (0021, 0022): Pai is one People person (`PAI_PEOPLE_ID`) with a regular Keep account, a member
 * wherever an agent was, holding the agents' keys; every value, comment, version and page naming an agent names Pai.
 * Every agent key thereby reaches every workspace Pai joins (plan D1, G14): the report lists each merged agent, its
 * workspace and key count, so the owner can revoke keys that were not Pai's.
 * Runs from `scripts/migrate.ts` before the SQL migrations, while the agent table is there, in one transaction.
 * Idempotent: a second run finds no agents left.
 */
export async function retireAgents() {
  const [{ count }] = (await db.execute(sql`select count(*)::int as count from "agent"`)) as unknown as [
    { count: number },
  ];
  if (!count) return { agents: 0 };
  const paiPeopleId = env.PAI_PEOPLE_ID;
  if (!paiPeopleId)
    throw new Error(`Keep has ${count} agent(s), which become Pai: set PAI_PEOPLE_ID to Pai's People person id`);
  if (!(await peopleApi.get(paiPeopleId))) throw new Error(`People has no person ${paiPeopleId} (PAI_PEOPLE_ID)`);

  return db.transaction(async (tx) => {
    // Raw SQL with named columns: this runs before the SQL migrations, so the table lacks columns the schema has now.
    type Account = { id: string; peopleId: string | null };
    const first = async (query: ReturnType<typeof sql>) =>
      ((await tx.execute(query)) as unknown as Account[])[0] as Account | undefined;
    let pai = await first(
      sql`select "id", "people_id" as "peopleId" from "person" where "people_id" = ${paiPeopleId} limit 1`,
    );
    if (!pai) {
      const stray = await first(sql`select "id", "people_id" as "peopleId" from "person"
        where "name" = 'Pai' and "user_id" is null and "email" is null limit 1`);
      if (stray)
        throw new Error(
          `Account ${stray.id} is a Pai linked to People person ${stray.peopleId}, not PAI_PEOPLE_ID ${paiPeopleId}: ` +
            "fix one of them first",
        );
      pai = await first(sql`insert into "person" ("name", "people_id") values ('Pai', ${paiPeopleId})
        returning "id", "people_id" as "peopleId"`);
      if (!pai) throw new Error("Could not create Pai's account");
    }
    const merged = (await tx.execute(sql`
      select a."id", a."name", a."url", a."workspace_id" as "workspaceId",
        (select count(*)::int from "token" t where t."agent_id" = a."id") as "keys"
      from "agent" a order by a."workspace_id", a."name"`)) as unknown as {
      id: string;
      name: string;
      url: string;
      workspaceId: string;
      keys: number;
    }[];
    const memberships = await tx.execute(sql`
      insert into "membership" ("person_id", "workspace_id", "role")
      select distinct ${pai.id}::uuid, "workspace_id", 'member'::role from "agent"
      on conflict ("person_id", "workspace_id") do update set "role" = 'member'::role
      where "membership"."role" = 'guest'::role`);
    const tokens = await tx.execute(
      sql`update "token" set "person_id" = ${pai.id}, "agent_id" = null where "agent_id" is not null`,
    );
    const authors = {
      comments: rows(
        await tx.execute(sql`update "comment" set "author_id" = ${paiPeopleId} where "author_kind" = 'agent'`),
      ),
      versions: rows(
        await tx.execute(sql`update "page_version" set "author_id" = ${paiPeopleId} where "author_kind" = 'agent'`),
      ),
      pages: rows(
        await tx.execute(
          sql`update "page" set "created_by" = ${paiPeopleId} where "created_by" in (select "id" from "agent")`,
        ),
      ),
      emoji: rows(
        await tx.execute(
          sql`update "custom_emoji" set "created_by" = ${paiPeopleId} where "created_by" in (select "id" from "agent")`,
        ),
      ),
    };
    const values = await remapValues(tx, '%"agent"%', (a) => (a.kind === "agent" ? paiPeopleId : undefined));
    await tx.execute(sql`delete from "agent"`);
    return {
      agents: count,
      merged: [...merged],
      pai: { account: pai.id, peopleId: paiPeopleId },
      memberships: rows(memberships),
      tokens: rows(tokens),
      authors,
      values,
    };
  });
}

/** Author columns still holding a Keep account id, rewritten to that account's People id. */
async function remapAuthors() {
  const count = async (query: ReturnType<typeof sql>) => rows(await db.execute(query));
  return {
    comments: await count(sql`update "comment" c set "author_id" = p."people_id" from "person" p
      where c."author_id" = p."id" and p."people_id" is not null`),
    versions: await count(sql`update "page_version" v set "author_id" = p."people_id" from "person" p
      where v."author_id" = p."id" and p."people_id" is not null`),
    pages: await count(sql`update "page" g set "created_by" = p."people_id" from "person" p
      where g."created_by" = p."id" and p."people_id" is not null`),
    emoji: await count(sql`update "custom_emoji" e set "created_by" = p."people_id" from "person" p
      where e."created_by" = p."id" and p."people_id" is not null`),
  };
}

/**
 * People moved to the People app: every account gets its People person, and every person value (of pages and their
 * versions) and author naming an account is rewritten to that People person. Idempotent — People ids are never
 * account ids, so a second run finds nothing to do.
 */
export async function backfillPeople() {
  const unlinked = await db.query.people.findMany({ where: isNull(people.peopleId) });
  for (const account of unlinked) await linkPeople(account);
  const accounts = await db.query.people.findMany({ columns: { id: true, peopleId: true } });
  const peopleIds = new Map(accounts.flatMap((a) => (a.peopleId ? [[a.id, a.peopleId] as const] : [])));
  const values = await remapValues(db, '%"person"%', (a) => (a.kind === "person" ? peopleIds.get(a.id) : undefined));
  return { linked: unlinked.length, values, authors: await remapAuthors() };
}
