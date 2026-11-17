import { randomUUID } from "node:crypto";
import { waitUntil } from "@elumixor/devkit/runtime";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "~/db";
import { type comments, notifications, pages, webhookDeliveries, webhooks } from "~/db/schema";
import { type Snapshot, snapshotOf } from "~/model/history";
import type { MentionWhere } from "~/model/mentions";
import {
  type ChangeItem,
  type EventType,
  isContentChange,
  type KeepEvent,
  pageChanges,
  WATCH_WINDOW_MS,
} from "~/model/watch";
import { canReadAs } from "../access";
import type { Caller } from "../auth/caller";
import { readableProperties } from "../pages/readable";
import { peopleApi } from "../people-api/client";
import { buildCommentEvent, buildPageEvent, type EventMeta } from "../webhooks/events";
import { drain } from "./deliver";
import { CHANGES_MAX, changesText, clipText, deepLink, directTitle, named, watchTitle } from "./text";
import { type Watch, watchersOf } from "./watch";

type PageRow = Omit<typeof pages.$inferSelect, "text" | "headings" | "search">;
type CommentRow = typeof comments.$inferSelect;

/** A notification for one person: named somewhere, answered, given a page or a workspace. */
export interface NotifyInput {
  readonly type: "mention" | "reply" | "share" | "invite";
  /** The recipient's People id. */
  readonly to: string;
  /** The page it is about; for an invite, the workspace's root. */
  readonly pageId: string;
  readonly commentId?: string;
  readonly mention?: MentionWhere;
  readonly property?: string;
  readonly role?: string;
  /** Already authorized and their access exists (a share, an invite): no read check. */
  readonly trusted?: boolean;
  /** What it says beyond the title: where they are named, the reply. */
  readonly text?: string;
}

/** A page written: its watchers and the workspace's webhooks hear of it. */
export interface PageWrite {
  readonly kind: "created" | "changed" | "trashed" | "restored" | "moved";
  /** The row before the write (null when created). */
  readonly before: PageRow | null;
  readonly after: PageRow;
  /** The input keys the write named (a webhook's `changed`). */
  readonly changed: readonly string[];
  /** A move's old parent. */
  readonly fromParentId?: string | null;
  /** Under the page a trash or restore started from: its own watchers hear of it, nobody else. */
  readonly nested?: boolean;
  /** Only the webhooks hear of it: a trait rewriting its pages tells no watcher (an accepted gap). */
  readonly quiet?: boolean;
}

export interface CommentWrite {
  readonly kind: "created" | "changed" | "deleted";
  /** The comment as it is now (as it was, when deleted). */
  readonly comment: CommentRow;
}

/** Of two direct notifications to one person about one page, the one kept. */
const RANK: Record<NotifyInput["type"], number> = { reply: 4, mention: 3, share: 2, invite: 1 };

const COMMENT_SUMMARY_MAX = 120;
const ACTOR_NAME_MAX = 80;

/**
 * A watch's changes kept within `CHANGES_MAX`: what is on the page first (a line per field, recomputed each time), then
 * what happened around it; the latter's overflow adds to `more`, the count told as "and N more".
 */
function capped(content: readonly ChangeItem[], others: readonly ChangeItem[], more: number) {
  const kept = content.slice(0, CHANGES_MAX);
  const room = CHANGES_MAX - kept.length;
  return { changes: [...kept, ...others.slice(0, room)], more: more + Math.max(0, others.length - room) };
}

/** What a write tells a watched page's watchers: a few lines, and the page before and after when its content changed. */
interface Target {
  readonly pageId: string;
  readonly items: readonly ChangeItem[];
  readonly content?: { readonly before: Snapshot; readonly after: Snapshot };
  readonly commentId?: string;
}

/** One watcher's share of a write. */
interface Group {
  readonly watch: Watch;
  readonly pageId: string;
  items: ChangeItem[];
  content?: { before: Snapshot; after: Snapshot };
  commentId?: string;
}

const PAGE_EVENT: Record<PageWrite["kind"], Extract<EventType, `page.${string}`>> = {
  created: "page.created",
  changed: "page.changed",
  moved: "page.changed",
  trashed: "page.deleted",
  // A page back from the trash is new again to whoever forgot it.
  restored: "page.created",
};

/**
 * What one write tells people and apps, collected while it runs and written, inside its transaction, last: direct
 * notifications (deduped per person and page, a reply over a mention), watches (coalesced per watcher, client and
 * page over `WATCH_WINDOW_MS`) and webhook deliveries. Nobody is told of their own write, and nobody of a page they
 * cannot read; a watch only skips its own client's writes, so an assistant's other threads still hear.
 */
export class Outbox {
  readonly #direct: NotifyInput[] = [];
  readonly #pages: PageWrite[] = [];
  readonly #comments: CommentWrite[] = [];
  readonly #rows = new Map<string, PageRow>();
  readonly #reads = new Map<string, boolean>();

  constructor(
    private readonly tx: Tx,
    private readonly caller: Caller,
  ) {}

  notify(input: NotifyInput) {
    this.#direct.push(input);
  }

  page(write: PageWrite) {
    this.#pages.push(write);
    this.#rows.set(write.after.id, write.after);
  }

  comment(write: CommentWrite) {
    this.#comments.push(write);
  }

  get #actor() {
    return this.caller.person.peopleId;
  }

  get #actorName() {
    return clipText(this.caller.person.name, ACTOR_NAME_MAX) || "Someone";
  }

  async #page(id: string) {
    if (!this.#rows.has(id)) {
      const row = await this.tx.query.pages.findFirst({ where: eq(pages.id, id) });
      if (row) this.#rows.set(id, row);
    }
    return this.#rows.get(id) ?? null;
  }

  async #canRead(peopleId: string, pageId: string) {
    const key = `${peopleId}|${pageId}`;
    if (!this.#reads.has(key)) {
      const own = await canReadAs(this.tx, peopleId, pageId);
      // A group, or someone who exists only inside one, reads with its leader's access.
      const leader = own ? null : await peopleApi.leaderFor(peopleId);
      this.#reads.set(key, own || (leader !== null && (await canReadAs(this.tx, leader, pageId))));
    }
    return this.#reads.get(key) === true;
  }

  /** Writes what was collected; resolves with how many rows are due now (a delivery worth starting). */
  async flush(): Promise<number> {
    if (!this.#direct.length && !this.#pages.length && !this.#comments.length) return 0;
    const told = await this.#flushDirect();
    await this.#flushWatches(told.keys);
    return told.count + (await this.#flushWebhooks());
  }

  async #flushDirect() {
    const best = new Map<string, NotifyInput>();
    for (const input of this.#direct) {
      // Nobody is told what they did themself.
      if (input.to === this.#actor) continue;
      const key = `${input.to}|${input.pageId}`;
      const held = best.get(key);
      if (!held || RANK[input.type] > RANK[held.type]) best.set(key, input);
    }
    const keys = new Set<string>();
    let count = 0;
    for (const [key, input] of best) {
      const page = await this.#page(input.pageId);
      if (!page) continue;
      if (!input.trusted && (page.deletedAt || !(await this.#canRead(input.to, page.id)))) continue;
      keys.add(key);
      const workspaceId = page.workspaceId ?? page.id;
      await this.tx.insert(notifications).values({
        recipient: input.to,
        type: input.type,
        workspaceId,
        pageId: page.id,
        commentId: input.commentId ?? null,
        actor: this.#actor,
        title: directTitle(input.type, this.#actorName, page.title, input.mention === "property"),
        text: input.text ? clipText(input.text) : null,
        url: deepLink(workspaceId, page.id, input.commentId),
        data: {
          ...(input.mention && { mention: input.mention }),
          ...(input.property && { property: input.property }),
          ...(input.role && { role: input.role }),
          ...(this.caller.client && { via: this.caller.client }),
        },
      });
      count++;
    }
    return { keys, count };
  }

  #targets(): Target[] {
    const targets: Target[] = [];
    for (const write of this.#pages) {
      if (write.quiet) continue;
      const page = write.after;
      const title = named(page.title);
      switch (write.kind) {
        case "changed":
          targets.push({
            pageId: page.id,
            items: [],
            content: { before: snapshotOf(write.before ?? page), after: snapshotOf(page) },
          });
          break;
        case "created":
          if (page.parentId)
            targets.push({ pageId: page.parentId, items: [{ kind: "child-added", summary: `Added "${title}"` }] });
          break;
        case "trashed":
          targets.push({ pageId: page.id, items: [{ kind: "trashed", summary: "Moved to trash" }] });
          if (!write.nested && page.parentId)
            targets.push({ pageId: page.parentId, items: [{ kind: "child-removed", summary: `Removed "${title}"` }] });
          break;
        case "restored":
          targets.push({ pageId: page.id, items: [{ kind: "restored", summary: "Restored from trash" }] });
          if (!write.nested && page.parentId)
            targets.push({ pageId: page.parentId, items: [{ kind: "child-added", summary: `Restored "${title}"` }] });
          break;
        case "moved":
          if (write.fromParentId === page.parentId) break;
          if (write.fromParentId)
            targets.push({
              pageId: write.fromParentId,
              items: [{ kind: "child-removed", summary: `Moved "${title}" away` }],
            });
          if (page.parentId)
            targets.push({ pageId: page.parentId, items: [{ kind: "child-added", summary: `Moved "${title}" here` }] });
          break;
      }
    }
    for (const { kind, comment } of this.#comments) {
      if (kind === "deleted") continue;
      const said = clipText(comment.body, COMMENT_SUMMARY_MAX);
      const summary =
        kind === "created" ? `${this.#actorName} commented: ${said}` : `${this.#actorName} edited a comment: ${said}`;
      targets.push({ pageId: comment.pageId, items: [{ kind: "comment", summary }], commentId: comment.id });
    }
    return targets;
  }

  async #flushWatches(direct: ReadonlySet<string>) {
    const targets = this.#targets();
    const watches = await watchersOf(
      this.tx,
      targets.map((t) => t.pageId),
    );
    if (!watches.length) return;
    const groups = new Map<string, Group>();
    for (const target of targets) {
      for (const watch of watches) {
        if (watch.pageId !== target.pageId) continue;
        // Their own write through the same client: they know. Another client of theirs (another thread) is told.
        if (watch.peopleId === this.#actor && (watch.client ?? null) === (this.caller.client ?? null)) continue;
        // Named or answered on this page by this write: that notification says it.
        if (direct.has(`${watch.peopleId}|${target.pageId}`)) continue;
        if (!(await this.#canRead(watch.peopleId, target.pageId))) continue;
        const key = `${watch.peopleId}|${watch.client ?? ""}|${target.pageId}`;
        const group = groups.get(key) ?? { watch, pageId: target.pageId, items: [] };
        group.items.push(...target.items);
        if (target.content)
          group.content = { before: group.content?.before ?? target.content.before, after: target.content.after };
        if (target.commentId) group.commentId = target.commentId;
        groups.set(key, group);
      }
    }
    for (const [key, group] of groups) await this.#coalesce(key, group);
  }

  /** Merges a watcher's changes into the notification still within its window, or opens one. */
  async #coalesce(key: string, group: Group) {
    const tx = this.tx;
    const page = await this.#page(group.pageId);
    if (!page) return;
    const workspaceId = page.workspaceId ?? page.id;
    const via = this.caller.client ? { via: this.caller.client } : {};
    // Two writes at once to one watcher's page wait for each other here, so they land in one row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [open] = await tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.coalesceKey, key),
          eq(notifications.state, "pending"),
          // Never leased: one a drain has taken is sending as it is, so later changes open a new one.
          eq(notifications.attempts, 0),
          gt(notifications.windowEndsAt, sql`clock_timestamp()`),
        ),
      )
      .limit(1)
      .for("update");
    const content = (base: Snapshot) =>
      group.content ? pageChanges(base, group.content.after, readableProperties) : [];
    if (open) {
      const base = open.base ?? group.content?.before ?? snapshotOf(page);
      const held = open.data.changes ?? [];
      const { changes, more } = capped(
        group.content ? content(base) : held.filter(isContentChange),
        [...held.filter((c) => !isContentChange(c)), ...group.items],
        open.data.more ?? 0,
      );
      // Edits that undid themselves leave nothing to tell.
      if (!changes.length) {
        await tx.delete(notifications).where(eq(notifications.id, open.id));
        return;
      }
      // One person's changes name them; once a second one's join, the actor is cleared and stays so.
      const alone = open.actor === this.#actor;
      await tx
        .update(notifications)
        .set({
          actor: alone ? this.#actor : null,
          title: watchTitle(page.title, alone ? this.#actorName : null),
          text: changesText(changes, more),
          url: deepLink(workspaceId, page.id, group.commentId ?? open.commentId),
          commentId: group.commentId ?? open.commentId,
          data: { ...open.data, ...via, changes, ...(more && { more }) },
          base,
          readAt: null,
          updatedAt: new Date(),
        })
        .where(eq(notifications.id, open.id));
      return;
    }
    const base = group.content?.before ?? snapshotOf(page);
    const { changes, more } = capped(content(base), group.items, 0);
    if (!changes.length) return;
    const id = randomUUID();
    // The database's clock, as every comparison against the window is made there.
    const windowEndsAt = sql`now() + make_interval(secs => ${WATCH_WINDOW_MS / 1000})`;
    await tx.insert(notifications).values({
      id,
      recipient: group.watch.peopleId,
      type: "watch",
      workspaceId,
      pageId: page.id,
      commentId: group.commentId ?? null,
      actor: this.#actor,
      client: group.watch.client,
      title: watchTitle(page.title, this.#actorName),
      text: changesText(changes, more),
      url: deepLink(workspaceId, page.id, group.commentId),
      data: { changes, since: id, ...via, ...(more && { more }) },
      base,
      coalesceKey: key,
      windowEndsAt,
      nextAttemptAt: windowEndsAt,
    });
  }

  async #flushWebhooks() {
    const workspaceIds = new Set([
      ...this.#pages.map((w) => w.after.workspaceId ?? w.after.id),
      ...this.#comments.map((w) => w.comment.workspaceId),
    ]);
    if (!workspaceIds.size) return 0;
    const hooks = await this.tx
      .select({ id: webhooks.id, workspaceId: webhooks.workspaceId, events: webhooks.events })
      .from(webhooks)
      .where(inArray(webhooks.workspaceId, [...workspaceIds]));
    if (!hooks.length) return 0;
    const ts = new Date().toISOString();
    // Each event has its own id, the same across the hooks it goes to.
    const eventMeta = (): EventMeta => ({ id: randomUUID(), ts, actor: this.#actor, client: this.caller.client });
    const wanted = (workspaceId: string, type: EventType) =>
      hooks.filter((h) => h.workspaceId === workspaceId && h.events.includes(type));
    const deliveries: { webhookId: string; event: KeepEvent }[] = [];
    for (const write of this.#pages) {
      if (write.nested) continue;
      const type = PAGE_EVENT[write.kind];
      const to = wanted(write.after.workspaceId ?? write.after.id, type);
      if (!to.length) continue;
      const changes: ChangeItem[] | null =
        write.kind === "trashed"
          ? [{ kind: "trashed", summary: "Moved to trash" }]
          : write.kind === "restored"
            ? [{ kind: "restored", summary: "Restored from trash" }]
            : write.kind === "created" || write.kind === "moved"
              ? []
              : null;
      const event = await buildPageEvent(this.tx, type, write, changes, eventMeta());
      for (const hook of to) deliveries.push({ webhookId: hook.id, event });
    }
    for (const { kind, comment } of this.#comments) {
      const type = `comment.${kind}` as const;
      const to = wanted(comment.workspaceId, type);
      if (!to.length) continue;
      const summary =
        kind === "deleted"
          ? "Comment deleted"
          : `${kind === "created" ? "Commented" : "Edited a comment"}: ${clipText(comment.body, COMMENT_SUMMARY_MAX)}`;
      const event = buildCommentEvent(type, comment, [{ kind: "comment", summary }], eventMeta());
      for (const hook of to) deliveries.push({ webhookId: hook.id, event });
    }
    if (deliveries.length) await this.tx.insert(webhookDeliveries).values(deliveries);
    return deliveries.length;
  }
}

let committed = 0;

/** How many writes this instance has committed: what it caches from the database is stale once this moved. */
export const writesCommitted = () => committed;

/** When this instance last drained: a write drains what fell due meanwhile (a watch's window), at most once a minute. */
let drainedAt = 0;
const DRAIN_EVERY_MS = 60_000;

/** Sends what is due now, after the response went out. */
export function kickDelivery() {
  drainedAt = Date.now();
  waitUntil(drain({ limit: 50 }).catch((error) => console.error("[outbox] drain", error)));
}

/**
 * A write's transaction with its outbox: what it notifies is written in the same transaction (or not at all), and
 * delivery starts once it committed.
 */
export async function transact<T>(caller: Caller, fn: (tx: Tx, out: Outbox) => Promise<T>): Promise<T> {
  let due = 0;
  const result = await db.transaction(async (tx) => {
    const out = new Outbox(tx, caller);
    const value = await fn(tx, out);
    due = await out.flush();
    return value;
  });
  committed++;
  // The write path does most of the sending; the server's timer picks up what falls due later.
  if (due || Date.now() - drainedAt > DRAIN_EVERY_MS) kickDelivery();
  return result;
}
