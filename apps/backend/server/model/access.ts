import type { Role } from "./roles";

/** What a page share gives: read it, also comment, also edit, or all that and share it further and delete it. */
export const SHARE_ROLES = ["view", "comment", "edit", "full"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

/** Somebody's standing on a page, weakest first: a share's role, or a workspace owner's above them all. */
export const ACCESS = ["none", "view", "comment", "edit", "full", "owner"] as const;
export type Access = (typeof ACCESS)[number];

/** What a caller may want to do: see, comment, change, trash, share a page, or run its workspace (members, webhooks). */
export type Action = "read" | "comment" | "write" | "delete" | "share" | "admin";

/** A workspace role as page access: members do everything but run the workspace, guests read and comment. */
export const ROLE_ACCESS: Readonly<Record<Role, Access>> = { owner: "owner", member: "full", guest: "comment" };

const ALLOWED: Readonly<Record<Access, readonly Action[]>> = {
  none: [],
  view: ["read"],
  comment: ["read", "comment"],
  edit: ["read", "comment", "write"],
  full: ["read", "comment", "write", "delete", "share"],
  owner: ["read", "comment", "write", "delete", "share", "admin"],
};

/** The whole permission policy: every check in the API is a lookup of the access followed by this. */
export const may = (access: Access, action: Action) => ALLOWED[access].includes(action);

export const highest = (...levels: readonly Access[]): Access =>
  levels.reduce<Access>((best, level) => (ACCESS.indexOf(level) > ACCESS.indexOf(best) ? level : best), "none");

/** The share nearest a page: `chain` is the page's id first, then its ancestors' up to the root. */
export function nearestShare(chain: readonly string[], shares: ReadonlyMap<string, ShareRole>): ShareRole | null {
  for (const id of chain) {
    const role = shares.get(id);
    if (role) return role;
  }
  return null;
}

/** Access to a page: the better of the workspace role and the share nearest it. */
export const accessOf = (role: Role | null, share: ShareRole | null): Access =>
  highest(role ? ROLE_ACCESS[role] : "none", share ?? "none");

/** What a screen asks of a page's access, as booleans. */
export const abilities = (access: Access) => ({
  read: may(access, "read"),
  comment: may(access, "comment"),
  write: may(access, "write"),
  delete: may(access, "delete"),
  share: may(access, "share"),
});
