import { relations } from "drizzle-orm";
import { pages } from "./pages";

export const pageRelations = relations(pages, ({ one }) => ({
  parent: one(pages, { fields: [pages.parentId], references: [pages.id], relationName: "parent" }),
}));
