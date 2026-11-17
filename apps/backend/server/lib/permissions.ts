import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import { db } from "~/db";
import type { Role } from "~/db/schema";
import { memberships, pages } from "~/db/schema";
import { type Access, type Action, may, ROLE_ACCESS } from "~/model/access";
import { UUID } from "~/model/urn";
import { accessFor, visits } from "./access";
import type { Caller } from "./auth/caller";
import { ForbiddenError, NotFoundError } from "./http/api-error";

export type { Access, Action };

/** The caller's role in a workspace, or null when they are no member of it. */
export async function workspaceRole(caller: Caller, workspaceId: string): Promise<Role | null> {
  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.personId, caller.person.id), eq(memberships.workspaceId, workspaceId)),
  });
  return membership?.role ?? null;
}

/**
 * Throws unless the caller may do `action` in the workspace. A workspace the caller cannot read does not exist to them.
 * With `visitor`, somebody holding only shares in it may read it too (its traits, emoji, extensions, members).
 */
export async function authorizeWorkspace(
  caller: Caller,
  workspaceId: string,
  action: Action,
  opts: { readonly visitor?: boolean } = {},
): Promise<Access> {
  if (!UUID.test(workspaceId)) throw new NotFoundError("Workspace");
  const role = await workspaceRole(caller, workspaceId);
  if (!role) {
    if (opts.visitor && (await visits(caller.person.id, workspaceId))) {
      if (action !== "read") throw new ForbiddenError();
      return "view";
    }
    throw new NotFoundError("Workspace");
  }
  const access = ROLE_ACCESS[role];
  if (!may(access, action)) throw new ForbiddenError();
  return access;
}

type PageRow = typeof pages.$inferSelect;

/** A page as authorizing reads it: never its search columns (`text`, `headings`, `search`), its body only when asked. */
export type Page = Omit<PageRow, "text" | "headings" | "search" | "body">;
export type PageWithBody = Page & Pick<PageRow, "body">;

const { text: _text, headings: _headings, search: _search, body: _body, ...pageColumns } = getTableColumns(pages);
const withBody = { ...pageColumns, body: pages.body };

/** The caller's access to a page: their workspace role, raised by the share nearest it. */
export const pageAccess = (caller: Caller, pageId: string) => accessFor(db, caller.person.id, pageId);

interface Read {
  /** Read the body too, for what shows or changes it. */
  readonly body?: boolean;
}

/** A page the caller may do `action` to, with their access to it; one they cannot read is not there to them. */
export async function authorizedPage(
  caller: Caller,
  pageId: string,
  action: Action,
  read: Read & { body: true },
): Promise<{ page: PageWithBody; access: Access }>;
export async function authorizedPage(
  caller: Caller,
  pageId: string,
  action: Action,
  read?: Read,
): Promise<{ page: Page; access: Access }>;
export async function authorizedPage(caller: Caller, pageId: string, action: Action, read: Read = {}) {
  if (!UUID.test(pageId)) throw new NotFoundError("Page");
  const [[page], access] = await Promise.all([
    db
      .select(read.body ? withBody : pageColumns)
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1),
    pageAccess(caller, pageId),
  ]);
  if (!page || !may(access, "read")) throw new NotFoundError("Page");
  if (!may(access, action)) throw new ForbiddenError();
  return { page, access };
}

/** Loads a page the caller may do `action` to, or throws as if it were not there. */
export async function authorizePage(
  caller: Caller,
  pageId: string,
  action: Action,
  read: Read & { body: true },
): Promise<PageWithBody>;
export async function authorizePage(caller: Caller, pageId: string, action: Action, read?: Read): Promise<Page>;
export async function authorizePage(caller: Caller, pageId: string, action: Action, read: Read = {}) {
  return (await authorizedPage(caller, pageId, action, read)).page;
}

/** Many pages the caller may each do `action` to, by id. */
export async function authorizePages(caller: Caller, ids: readonly string[], action: Action) {
  const unique = [...new Set(ids)];
  if (unique.some((id) => !UUID.test(id))) throw new NotFoundError("Page");
  const [rows, levels] = await Promise.all([
    unique.length ? db.query.pages.findMany({ where: inArray(pages.id, unique) }) : [],
    Promise.all(unique.map((id) => pageAccess(caller, id))),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  unique.forEach((id, i) => {
    if (!byId.has(id) || !may(levels[i], "read")) throw new NotFoundError("Page");
    if (!may(levels[i], action)) throw new ForbiddenError();
  });
  return byId;
}
