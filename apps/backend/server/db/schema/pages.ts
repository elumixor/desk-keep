import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DocNode } from "../../model/document";
import type { Manifest } from "../../model/extensions";
import { NODE_KINDS } from "../../model/nodes";
import type { PropertyValues, Schema } from "../../model/properties";
import type { Cleanup, Filter, Sort } from "../../model/views";
import { tsvector } from "./tsvector";

export const nodeKindEnum = pgEnum("node_kind", NODE_KINDS);

/**
 * Everything is a node of one tree: a workspace is a root page. A page holds its properties (`schema`) and their values
 * by name (`properties`); a trait is a named set of properties (its `schema`) whose pages are the ones having them all
 * (`model/traits.ts`), kept in `traits`; a view is a saved query (`views`). A trait or view uses the title, icon and
 * body (its description), never values. `workspaceId` is written by the server from the ancestry on insert and move,
 * never taken from a client.
 */
export const pages = pgTable(
  "page",
  {
    id: uuid().primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => pages.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references((): AnyPgColumn => pages.id, { onDelete: "cascade" }),
    kind: nodeKindEnum().notNull().default("page"),
    title: text().notNull().default(""),
    icon: text(),
    /** One plain line shown under the title. */
    description: text().notNull().default(""),
    body: jsonb().$type<DocNode>(),
    /** Values by property name. */
    properties: jsonb().$type<PropertyValues>().notNull().default({}),
    /** The page's property definitions (`model/properties.ts`); a trait's are what its pages have. */
    schema: jsonb().$type<Schema>().notNull().default([]),
    /** Ids of the traits whose properties the page has, worked out by the server on every change (`model/traits.ts`). */
    traits: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    sort: doublePrecision().notNull().default(0),
    text: text().notNull().default(""),
    /** The body's headings, so search ranks a match there between the title and the rest of the text. */
    headings: text().notNull().default(""),
    search: tsvector().generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce("title", '')), 'A') || setweight(to_tsvector('simple', coalesce("headings", '')), 'B') || setweight(to_tsvector('simple', coalesce("text", '')), 'C')`,
    ),
    /** The creator's People person id. */
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * Put away, not trashed: left out of the tree, views and `find_pages` unless asked for, still read by id and kept on
     * devices (`lib/pages/archive.ts`). Only the page itself; what is under it hides with it in the tree.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** When any write last touched the row, set by a trigger (`sync.ts`): what a client's sync asks "since" against. */
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("page_parent").on(t.parentId, t.sort),
    index("page_workspace").on(t.workspaceId, t.syncedAt),
    index("page_search").using("gin", t.search),
    index("page_traits").using("gin", t.traits),
    // The nodes having a property of a name, and the pages that could have a trait (`prop_keys`, a SQL function).
    index("page_prop_keys").using("gin", sql`prop_keys(${t.schema})`),
    // Two nodes under one parent never share a name, so a trait or view is found by its path. A trait may share its
    // view's (the view showing it alone, `titleTaken`): traits are kept apart by the server alone.
    uniqueIndex("page_title")
      .on(t.parentId, sql`lower(${t.title})`)
      .where(sql`${t.deletedAt} is null and ${t.title} <> '' and ${t.kind} <> 'trait'`),
  ],
);

export const VIEW_KIND_VALUES = ["table", "board", "list", "timeline"] as const;
export const viewKindEnum = pgEnum("view_kind", VIEW_KIND_VALUES);

/**
 * What a view node (a page of kind `view`, same id) shows: the pages having all of `traits` (any page when none),
 * filtered (values, title, dates, where they sit), sorted and grouped, laid out as a table, board, list or timeline.
 * `newParent` is where a page made in it goes; asked each time when null.
 */
export const views = pgTable("view", {
  id: uuid()
    .primaryKey()
    .references(() => pages.id, { onDelete: "cascade" }),
  kind: viewKindEnum().notNull(),
  traits: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  filter: jsonb().$type<Filter[]>().notNull().default([]),
  sort: jsonb().$type<Sort[]>().notNull().default([]),
  groupBy: text("group_by"),
  visibleProperties: jsonb("visible_properties").$type<string[]>(),
  /** A timeline's properties drawn beside its bars; all of them when null. */
  barProperties: jsonb("bar_properties").$type<string[]>(),
  /** JavaScript, as a formula's, whose value per page orders the view (ascending; an array sorts key by key). */
  sortCode: text("sort_code"),
  newParent: uuid("new_parent").references((): AnyPgColumn => pages.id, { onDelete: "set null" }),
  /** Whether it shows archived pages too. */
  showArchived: boolean("show_archived").notNull().default(false),
  /** Archives the pages it shows once a property has held a value for some days (`lib/cleanup.ts`). */
  cleanup: jsonb().$type<Cleanup>(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const LINK_KINDS = ["mention", "property", "embed"] as const;
export const linkKindEnum = pgEnum("link_kind", LINK_KINDS);

/** What a page points to, rebuilt by the server from the body and relation properties on every write. */
export const links = pgTable(
  "link",
  {
    fromPage: uuid("from_page")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    toUrn: text("to_urn").notNull(),
    kind: linkKindEnum().notNull(),
  },
  (t) => [index("link_from").on(t.fromPage), index("link_to").on(t.toUrn)],
);

/** Where a workspace's page events are posted. */
export const webhooks = pgTable("webhook", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  url: text().notNull(),
  secret: text().notNull(),
  events: jsonb().$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An app plugged into a workspace: it contributes property types (picked from its options endpoint) and actions
 * (buttons that call it). `token` is the bearer Keep sends to it, encrypted (`lib/extensions/secret.ts`) and never
 * returned; `manifest` is the last one fetched from `manifest_url`.
 */
export const extensions = pgTable(
  "extension",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    name: text().notNull(),
    manifestUrl: text("manifest_url").notNull(),
    token: text().notNull(),
    manifest: jsonb().$type<Manifest>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("extension_workspace").on(t.workspaceId)],
);

/**
 * A workspace's own emoji: a small picture under a name everyone in it can pick as an icon or type as `:name:`
 * (`model/icons.ts`). The picture is kept here as a data URL, small enough to send with the list.
 */
export const customEmoji = pgTable(
  "custom_emoji",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    name: text().notNull(),
    image: text().notNull(),
    /** The creator's People person id. */
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("custom_emoji_name").on(t.workspaceId, t.name)],
);
