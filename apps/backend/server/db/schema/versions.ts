import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { DocNode } from "../../model/document";
import type { ChangeSummary } from "../../model/history";
import type { PropertyValues, Schema } from "../../model/properties";
import { pages } from "./pages";

/**
 * A page's history: what it was after each round of edits. One author's edits close together are one version, so
 * autosave does not leave a version per keystroke. A version with no author is how the page was when history began.
 */
export const pageVersions = pgTable(
  "page_version",
  {
    id: uuid().primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    /** The author's People person id (`people:person/<id>`), as `page.created_by`. */
    authorId: uuid("author_id"),
    title: text().notNull(),
    icon: text(),
    body: jsonb().$type<DocNode>(),
    properties: jsonb().$type<PropertyValues>().notNull(),
    schema: jsonb().$type<Schema>().notNull(),
    /** What changed since the version before (`model/history.ts`). */
    changes: jsonb().$type<ChangeSummary>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** The last edit this version took in. */
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("page_version_page").on(t.pageId, t.createdAt)],
);
