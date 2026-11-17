import { inArray } from "drizzle-orm";
import type { Tx } from "~/db";
import { type comments, pages } from "~/db/schema";
import { snapshotOf } from "~/model/history";
import { commentUrn, pageUrn, personUrn } from "~/model/urn";
import { type ChangeItem, type EventType, type KeepEvent, pageChanges } from "~/model/watch";
import { readableProperties } from "../pages/readable";

export { EVENTS, type EventType, type KeepEvent } from "~/model/watch";

type PageRow = Omit<typeof pages.$inferSelect, "text" | "headings" | "search">;
type CommentRow = typeof comments.$inferSelect;

/** What every event of one write shares: its id, when, by whom and through which client. */
export interface EventMeta {
  readonly id: string;
  readonly ts: string;
  readonly actor: string | null;
  readonly client: string | null;
}

const common = (meta: EventMeta) => ({
  version: 2 as const,
  id: meta.id,
  ts: meta.ts,
  ...(meta.actor && { actor: personUrn(meta.actor) }),
  ...(meta.client && { client: meta.client }),
});

/**
 * A page event, read inside the write's transaction: a created or changed page carries what a page read does
 * (`schema`, its traits' names, `properties`), and every event the diff of what changed (`changes`).
 */
export async function buildPageEvent(
  tx: Tx,
  type: Extract<EventType, `page.${string}`>,
  write: { readonly before: PageRow | null; readonly after: PageRow; readonly changed: readonly string[] },
  changes: readonly ChangeItem[] | null,
  meta: EventMeta,
): Promise<KeepEvent> {
  const page = write.after;
  const base = {
    ...common(meta),
    type,
    urn: pageUrn(page.id),
    page: pageUrn(page.id),
    workspace: pageUrn(page.workspaceId ?? page.id),
    title: page.title,
    parentId: page.parentId,
    changed: write.changed,
    changes:
      changes ?? (write.before ? pageChanges(snapshotOf(write.before), snapshotOf(page), readableProperties) : []),
  };
  if (type === "page.deleted") return base;
  const traits = page.traits.length
    ? await tx.select({ title: pages.title }).from(pages).where(inArray(pages.id, page.traits))
    : [];
  return { ...base, schema: page.schema, traits: traits.map((t) => t.title), properties: page.properties ?? {} };
}

/** A comment event: about the comment (`urn`), on its page, with its text, author and what it answers. */
export function buildCommentEvent(
  type: Extract<EventType, `comment.${string}`>,
  comment: CommentRow,
  changes: readonly ChangeItem[],
  meta: EventMeta,
): KeepEvent {
  return {
    ...common(meta),
    type,
    urn: commentUrn(comment.id),
    page: pageUrn(comment.pageId),
    workspace: pageUrn(comment.workspaceId),
    changed: type === "comment.changed" ? ["body"] : [],
    changes,
    comment: { id: comment.id, body: comment.body, author: personUrn(comment.authorId), replyTo: comment.replyTo },
  };
}
