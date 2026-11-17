import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "~/db";
import { links, pages } from "~/db/schema";
import { type DocNode, extractLinks, headingText, plainText } from "~/model/document";
import { type Assignee, type PropertyValues, propertyText, type Schema } from "~/model/properties";
import { groupUrn, pageUrn, personUrn } from "~/model/urn";
import { computeFormulas } from "./formulas";

interface Derivable {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly body: DocNode | null;
  readonly properties: PropertyValues;
}

/**
 * Everything the server keeps from a page's content rather than takes from a client: formula results, the search
 * text and headings, and the links rows (mentions and embeds from the body, relations and people from the properties).
 */
export async function derive(tx: Tx, page: Derivable, schema: Schema) {
  const properties = await computeFormulas(tx, { ...page, schema });
  const text = [page.body ? plainText(page.body) : "", propertyText(schema, properties)].filter(Boolean).join("\n");

  const relationLinks = schema
    .filter((p) => p.type === "relation")
    .flatMap((p) =>
      ((properties[p.name] as string[] | undefined) ?? []).map((id) => ({
        urn: pageUrn(id),
        kind: "property" as const,
      })),
    );
  const personLinks = schema
    .filter((p) => p.type === "person")
    .flatMap((p) =>
      ((properties[p.name] as readonly Assignee[] | null | undefined) ?? [])
        .filter(Boolean)
        .map((a) => ({ urn: a.kind === "group" ? groupUrn(a.id) : personUrn(a.id), kind: "property" as const })),
    );
  const unique = new Map(
    [...(page.body ? extractLinks(page.body) : []), ...relationLinks, ...personLinks].map((l) => [
      `${l.kind}:${l.urn}`,
      l,
    ]),
  );
  const all = [...unique.values()];

  await tx.delete(links).where(eq(links.fromPage, page.id));
  if (all.length) await tx.insert(links).values(all.map((l) => ({ fromPage: page.id, toUrn: l.urn, kind: l.kind })));

  const headings = page.body ? headingText(page.body) : "";
  await tx.update(pages).set({ properties, text, headings }).where(eq(pages.id, page.id));
  return { properties, text, headings };
}

/**
 * Pages whose formulas read this one get their results recomputed after it changes: those relating to it, and its
 * parent (which reads it among its children).
 */
export async function refreshDependents(tx: Tx, pageId: string) {
  const rows = await tx
    .select({ id: links.fromPage })
    .from(links)
    .where(and(eq(links.toUrn, pageUrn(pageId)), eq(links.kind, "property")));
  const [changed] = await tx.select({ parentId: pages.parentId }).from(pages).where(eq(pages.id, pageId));
  const ids = [...new Set([...rows.map((r) => r.id), ...(changed?.parentId ? [changed.parentId] : [])])];
  if (!ids.length) return;
  const dependents = await tx.query.pages.findMany({ where: inArray(pages.id, ids) });
  for (const dependent of dependents)
    if (dependent.schema.some((p) => p.type === "formula")) await derive(tx, dependent, dependent.schema);
}
