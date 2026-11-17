import {
  type AnyPgColumn,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ROLES, type Role } from "../../model/roles";
import { pages } from "./pages";

/**
 * An account: somebody who signs in (`userId`, Clerk), was invited by email and has not yet, or has neither (an
 * assistant like Pai, who works with a key), with their memberships and keys. Who they are lives in People (`peopleId`, `people:person/<id>`); person properties point there.
 */
export const people = pgTable(
  "person",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id"),
    name: text().notNull(),
    email: text(),
    avatar: text(),
    peopleId: uuid("people_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** First sign-in or key use; null while an invite is pending. */
    joinedAt: timestamp("joined_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("person_user_id").on(t.userId),
    // A display cache: who somebody is lives in People (`people_id`), so two accounts may show one address.
    index("person_email").on(t.email),
    uniqueIndex("person_people_id").on(t.peopleId),
  ],
);

export { ROLES, type Role };
export const roleEnum = pgEnum("role", ROLES);

/** Who belongs to a workspace (a root page), and as what. */
export const memberships = pgTable(
  "membership",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    role: roleEnum().notNull(),
    invitedBy: uuid("invited_by").references((): AnyPgColumn => people.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    /** Stamped by a trigger: a membership granted since a device last pulled sends it the whole workspace. */
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.workspaceId] }), index("membership_workspace").on(t.workspaceId)],
);

/** An account's API keys (MCP, scripts), kept as hashes. */
export const tokens = pgTable("token", {
  id: uuid().primaryKey().defaultRandom(),
  hash: text().notNull().unique(),
  name: text().notNull(),
  personId: uuid("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});
