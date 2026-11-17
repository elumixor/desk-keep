import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import { links, memberships, pages, views } from "~/db/schema";
import { abilities } from "~/model/access";
import { pageUrn } from "~/model/urn";
import { inScope, scopeOf } from "../access";
import type { Caller } from "../auth/caller";
import { authorizedPage, authorizeWorkspace, workspaceRole } from "../permissions";
import { traitsOfPage, workspaceTraits } from "../traits";

/**
 * The subqueries below name the outer row as `"page"."…"` explicitly: an interpolated column renders unqualified,
 * and inside `from page p` that would be the inner row's own column.
 */

const summary = {
  id: pages.id,
  parentId: pages.parentId,
  workspaceId: pages.workspaceId,
  kind: pages.kind,
  title: pages.title,
  icon: pages.icon,
  sort: pages.sort,
  properties: pages.properties,
  schema: pages.schema,
  traits: pages.traits,
  updatedAt: pages.updatedAt,
} as const;

/** The page's ancestors from the workspace down to its parent; none for a workspace. */
export async function ancestorsOf(pageId: string) {
  const rows = await db.execute<{ id: string; title: string; icon: string | null }>(sql`
    with recursive up as (
      select p.id, p.parent_id, p.title, p.icon, 0 as depth from page p where p.id = (select parent_id from page where id = ${pageId})
      union all select p.id, p.parent_id, p.title, p.icon, up.depth + 1 from page p join up on p.id = up.parent_id
    ) select id, title, icon from up order by depth desc`);
  return [...rows];
}

/** A visitor's breadcrumbs start at the share they reach the page through: what is above it is not theirs to see. */
export function sharedPart<T extends { id: string }>(ancestors: readonly T[], roots: readonly string[]) {
  const top = ancestors.findIndex((a) => roots.includes(a.id));
  return top === -1 ? [] : ancestors.slice(top);
}

/**
 * A node with what its screen needs: where it sits, what is under it (the views among it with their queries), what
 * points to it, and for a view its own query.
 */
export async function getPage(caller: Caller, id: string) {
  const { page, access } = await authorizedPage(caller, id, "read", { body: true });
  const workspaceId = page.workspaceId ?? id;
  const [role, scope] = await Promise.all([workspaceRole(caller, workspaceId), scopeOf(caller.person.id)]);
  const [workspace, ancestors, children, backlinks, traits] = await Promise.all([
    db.query.pages.findFirst({ where: eq(pages.id, workspaceId), columns: { id: true, title: true, icon: true } }),
    ancestorsOf(id).then((all) =>
      role
        ? all
        : sharedPart(
            all,
            scope.shareRoots.map((r) => r.pageId),
          ),
    ),
    db
      .select(summary)
      .from(pages)
      // Archived children are out of the way here as in the tree; each is still read by id.
      .where(and(eq(pages.parentId, id), isNull(pages.deletedAt), isNull(pages.archivedAt)))
      .orderBy(asc(pages.sort)),
    db
      .selectDistinct({ id: pages.id, title: pages.title, icon: pages.icon, kind: links.kind })
      .from(links)
      .innerJoin(pages, eq(pages.id, links.fromPage))
      .where(and(eq(links.toUrn, pageUrn(id)), isNull(pages.deletedAt), inScope(scope))),
    workspaceTraits(workspaceId),
  ]);
  const viewIds = [
    ...children.filter((c) => c.kind === "view").map((c) => c.id),
    ...(page.kind === "view" ? [id] : []),
  ];
  const queries = viewIds.length ? await db.query.views.findMany({ where: inArray(views.id, viewIds) }) : [];
  return {
    page: {
      ...page,
      /** The traits the page has. */
      traits: traitsOfPage(page.traits, traits),
      /** A view's query. */
      view: queries.find((q) => q.id === id) ?? null,
    },
    ancestors,
    children,
    /** The views under the page, named, with their queries. */
    views: children.flatMap((c) => {
      const query = queries.find((q) => q.id === c.id);
      return query ? [{ ...query, name: c.title }] : [];
    }),
    backlinks,
    /** The page's workspace, named. */
    workspace: workspace ?? { id: workspaceId, title: "", icon: null },
    /** The caller's access here, and what it lets them do. */
    access,
    can: abilities(access),
    canEdit: abilities(access).write,
    /** Whether the caller is a member of the page's workspace, rather than a visitor with shares in it. */
    member: role !== null,
  };
}

/** The sidebar: every node of the workspace that is not archived, with what it is. */
export async function workspaceTree(caller: Caller, workspaceId: string) {
  await authorizeWorkspace(caller, workspaceId, "read");
  return await db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      kind: pages.kind,
      title: pages.title,
      icon: pages.icon,
      sort: pages.sort,
    })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt), isNull(pages.archivedAt)))
    .orderBy(asc(pages.sort));
}

export async function myWorkspaces(caller: Caller) {
  return await db
    .select({ id: pages.id, title: pages.title, icon: pages.icon, role: memberships.role })
    .from(memberships)
    .innerJoin(pages, eq(pages.id, memberships.workspaceId))
    .where(and(eq(memberships.personId, caller.person.id), isNull(pages.deletedAt)))
    .orderBy(asc(pages.createdAt));
}

/** What is in the trash: each deletion once, by the page it started from. */
export async function trash(caller: Caller, workspaceId: string) {
  await authorizeWorkspace(caller, workspaceId, "read");
  return await db
    .select({ id: pages.id, title: pages.title, icon: pages.icon, deletedAt: pages.deletedAt })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        isNotNull(pages.deletedAt),
        sql`coalesce((select p.deleted_at from page p where p.id = "page"."parent_id") <> "page"."deleted_at", true)`,
      ),
    )
    .orderBy(desc(pages.deletedAt));
}
