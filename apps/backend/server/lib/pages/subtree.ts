import { type SQL, sql } from "drizzle-orm";

/** The ids of the pages `roots` picks out and of every page under them. */
export const subtreeOf = (roots: SQL) => sql`
  with recursive tree as (
    select id from page where ${roots}
    union all select p.id from page p join tree t on p.parent_id = t.id
  ) select id from tree`;

export const subtree = (id: string) => subtreeOf(sql`id = ${id}`);

/** The ids of every page under a page, itself left out. */
export const below = (id: string) => subtreeOf(sql`parent_id = ${id}`);

/** Ids as a list SQL takes in `in (…)`. */
export const uuidList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** The ids of every page under any of `roots`, the roots among them. */
export const subtreeOfMany = (roots: readonly string[]) => subtreeOf(sql`id in (${uuidList(roots)})`);
