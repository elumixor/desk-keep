import type { SyncRequest } from "@elumixor/synced/protocol";
import {
  action,
  type Envelope,
  RejectedError,
  type SyncedStore,
  SyncServer,
  syncedModel,
} from "@elumixor/synced/server";
import { and, desc, eq, gte, inArray, isNull, lt, not, type SQL, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  commentReactions,
  comments,
  mutations,
  notifications,
  notificationTombstones,
  pages,
  pageWatches,
  syncRevocations,
  tombstones,
  views,
} from "~/db/schema";
import { findProperty, isWritten, type Schema } from "~/model/properties";
import {
  type CommentRecord,
  commentRecordSchema,
  movePayloadSchema,
  type NotificationRecord,
  notificationRecordSchema,
  type PageRecord,
  pageRecordSchema,
  type ReactionRecord,
  reactionRecordSchema,
  type ViewRecord,
  viewRecordSchema,
  type WatchRecord,
  watchRecordSchema,
} from "~/model/sync";
import { traitPayloadSchema } from "~/model/traits";
import { inScope, type Scope, scopeEmpty, scopeOf } from "./access";
import { accountId, authorId, type Caller } from "./auth/caller";
import { cleanupSaved } from "./cleanup";
import { deleteComment, saveComment, updateComment } from "./comments";
import { answerable } from "./http/answerable";
import { unwatchPage, watchPage } from "./notify/watch";
import { setArchived } from "./pages/archive";
import { subtreeOfMany, uuidList } from "./pages/subtree";
import { createPage, deletePage, movePage, movePages, type PageInput, restorePage, updatePage } from "./pages/write";
import { authorizePage } from "./permissions";
import { addReaction, removeReaction } from "./reactions";
import { revokeSync } from "./shares";
import { updateTrait } from "./traits";

/**
 * The app's one round trip (`POST /api/sync`): the writes a device queued, then everything in the caller's workspaces
 * that changed since it last asked. `synced_at` (a trigger) is the clock; a write that commits just after a reader
 * looked can carry an earlier stamp than the reader's `since`, so every pull reaches a little further back.
 */
const OVERLAP_MS = 5_000;
/** Carried-out writes are remembered this long: long enough for any device to come back online and retry. */
const REMEMBER_DAYS = 30;

type Pulled<T> = { id: string; syncedAt: Date; deleted: boolean; data: T };

const envelope = <T extends { id: string }>(row: Pulled<T>): Envelope<T> => ({
  id: row.id,
  updatedAt: row.syncedAt.getTime(),
  deleted: row.deleted,
  data: row.deleted ? null : row.data,
});

const after = (since: number) => new Date(Math.max(0, since - OVERLAP_MS));

/** A refusal (no access, an invalid value, a page in the trash) is final; anything else is worth the client retrying. */
async function refusing<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const answer = answerable(error);
    if (answer && answer.status < 500) throw new RejectedError(answer.message);
    throw error;
  }
}

/**
 * What a pull carries besides what changed in the caller's scope (`lib/access.ts`): the whole of what was granted since
 * the device last asked (a share's subtree, a membership's workspace; stamped no earlier than the grant, so it wins over
 * a revocation the device holds), and the deletions of what it may no longer read (`sync_revocation`).
 */
interface Grants {
  /** Shared subtrees granted (or changed) since: their roots, and the latest grant. */
  readonly roots: readonly string[];
  /** Workspaces joined since. */
  readonly workspaces: readonly string[];
  /** The latest grant: every page it carries is stamped no earlier. */
  readonly at: number;
}

function grantsSince(scope: Scope, since: number): Grants {
  const from = after(since).getTime();
  // A first pull takes everything in scope anyway.
  if (since === 0) return { roots: [], workspaces: [], at: 0 };
  const roots = scope.shareRoots.filter((r) => r.syncedAt.getTime() >= from);
  const joined = scope.memberships.filter((m) => m.syncedAt.getTime() >= from);
  const at = Math.max(0, ...roots.map((r) => r.syncedAt.getTime()), ...joined.map((m) => m.syncedAt.getTime()));
  return { roots: roots.map((r) => r.pageId), workspaces: joined.map((m) => m.workspaceId), at };
}

/** The pages (by `id`) a grant carries whole: under a fresh share root, or in a freshly joined workspace. */
function granted(grants: Grants, alias: string): SQL | null {
  const row = sql.raw(`"${alias}"`);
  const parts: SQL[] = [];
  if (grants.roots.length) parts.push(sql`${row}."id" in (${subtreeOfMany(grants.roots)})`);
  if (grants.workspaces.length) parts.push(sql`${row}."workspace_id" in (${uuidList(grants.workspaces)})`);
  return parts.length ? sql`(${sql.join(parts, sql` or `)})` : null;
}

/** The trait nodes of the workspaces a scope only visits: shared pages have their traits worked out from them. */
const visitorTraits = (scope: Scope) =>
  scope.visitorWorkspaceIds.length
    ? sql`("page"."kind" = 'trait' and "page"."workspace_id" in (${uuidList(scope.visitorWorkspaceIds)}))`
    : sql`false`;

/** Every node a scope may hold on a device: its pages, and the traits of the workspaces it visits. */
const holdable = (scope: Scope) => sql`(${inScope(scope)} or ${visitorTraits(scope)})`;

/**
 * The page ids revoked from the account since `since` that it can no longer read, each with when it was revoked: under
 * each revoked root (the root alone when purged meanwhile), and the traits of a workspace it no longer reaches at all.
 */
type Revoked = readonly { readonly id: string; readonly at: number; readonly kind: string | null }[];

async function revoked(scope: Scope, since: number): Promise<Revoked> {
  if (since === 0) return [];
  const revocations = await db
    .select()
    .from(syncRevocations)
    .where(and(eq(syncRevocations.personId, scope.accountId), gte(syncRevocations.syncedAt, after(since))));
  const out = new Map<string, { at: number; kind: string | null }>();
  const take = (id: string, at: number, kind: string | null) =>
    out.set(id, { at: Math.max(out.get(id)?.at ?? 0, at), kind });
  for (const revocation of revocations) {
    const at = revocation.syncedAt.getTime();
    const traits = reached(scope).includes(revocation.workspaceId)
      ? sql`false`
      : sql`("page"."kind" = 'trait' and "page"."workspace_id" = ${revocation.workspaceId})`;
    const rows = await db
      .select({ id: pages.id, kind: pages.kind })
      .from(pages)
      .where(and(sql`("page"."id" in (${subtreeOfMany([revocation.pageId])}) or ${traits})`, not(holdable(scope))));
    for (const row of rows) take(row.id, at, row.kind);
    const root = await db.query.pages.findFirst({ where: eq(pages.id, revocation.pageId), columns: { id: true } });
    // Purged meanwhile: whatever it was.
    if (!root) take(revocation.pageId, at, null);
  }
  return [...out].map(([id, { at, kind }]) => ({ id, at, kind }));
}

/** What was revoked since a model's `since`, worked out once per sync for every model that asks the same. */
type Revocations = (since: number) => Promise<Revoked>;

const revocationEnvelope = <T extends { id: string }>({ id, at }: Pick<Revoked[number], "id" | "at">): Envelope<T> => ({
  id,
  updatedAt: at,
  deleted: true,
  data: null,
});

const pageColumns = {
  id: pages.id,
  parentId: pages.parentId,
  workspaceId: pages.workspaceId,
  kind: pages.kind,
  title: pages.title,
  icon: pages.icon,
  description: pages.description,
  body: pages.body,
  properties: pages.properties,
  schema: pages.schema,
  traits: pages.traits,
  sort: pages.sort,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
  deletedAt: pages.deletedAt,
  archivedAt: pages.archivedAt,
  syncedAt: pages.syncedAt,
};

type PageRow = { [K in keyof typeof pageColumns]: (typeof pages.$inferSelect)[K] };

const pageRecord = (row: PageRow): PageRecord => ({
  id: row.id,
  parentId: row.parentId,
  workspaceId: row.workspaceId,
  kind: row.kind,
  title: row.title,
  icon: row.icon,
  description: row.description,
  body: row.body,
  properties: row.properties,
  schema: [...row.schema],
  traits: [...row.traits],
  sort: row.sort,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

const pageEnvelope = (row: PageRow) =>
  envelope({ id: row.id, syncedAt: row.syncedAt, deleted: !!row.deletedAt, data: pageRecord(row) });

async function readPage(id: string): Promise<Envelope<PageRecord>> {
  const [row] = await db.select(pageColumns).from(pages).where(eq(pages.id, id));
  if (!row) throw new RejectedError("That page does not exist");
  return pageEnvelope(row);
}

/**
 * A client sends a page's values whole, as it shows them; the server merges by key, so a key it no longer has is sent
 * as `null`, and formulas (computed here) and buttons (no value) are left out.
 */
function valuesToWrite(current: Record<string, unknown>, next: Record<string, unknown>, schema: Schema) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(current)) if (!(key in next)) out[key] = null;
  for (const [key, value] of Object.entries(next)) out[key] = value;
  for (const key of Object.keys(out)) {
    const definition = findProperty(schema, key);
    if (!definition || !isWritten(definition)) delete out[key];
  }
  return out;
}

function pageStore(caller: Caller, scope: Scope, revocations: Revocations): SyncedStore<PageRecord> {
  return {
    async pull(_user, since) {
      const gone = (await revocations(since)).map((r) => revocationEnvelope<PageRecord>(r));
      if (scopeEmpty(scope)) return newest(gone);
      const grants = grantsSince(scope, since);
      const rows = await db
        .select(pageColumns)
        .from(pages)
        .where(
          and(
            holdable(scope),
            gte(pages.syncedAt, after(since)),
            // A first pull has nothing to forget, so the trash stays on the server.
            since === 0 ? isNull(pages.deletedAt) : undefined,
          ),
        )
        .orderBy(pages.syncedAt);
      const whole = granted(grants, "page");
      const grantedRows = whole
        ? await db
            .select(pageColumns)
            .from(pages)
            .where(and(holdable(scope), isNull(pages.deletedAt), sql`(${whole} or ${visitorTraits(scope)})`))
        : [];
      return newest([
        ...rows.map(pageEnvelope),
        ...grantedRows.map((row) => stampedNoEarlier(pageEnvelope(row), grants.at)),
        ...gone,
        ...(await buried("pages", reached(scope), since)),
      ]);
    },
    read: async () => null,
    create: (_user, record) =>
      refusing(async () => {
        const existing = await db.query.pages.findFirst({ where: eq(pages.id, record.id), columns: { id: true } });
        // The same id again is an undone delete being redone, or a retry: the page comes back as it was sent.
        if (existing) {
          await restorePage(caller, record.id);
          return updateRecord(caller, record.id, record);
        }
        if (!record.parentId) throw new RejectedError("A page needs a parent");
        await createPage(caller, record.parentId, {
          id: record.id,
          kind: record.kind,
          sort: record.sort,
          title: record.title,
          icon: record.icon,
          description: record.description,
          body: record.body ?? undefined,
          schema: record.schema,
          properties: Object.fromEntries(Object.entries(record.properties).filter(([, v]) => v !== null)),
        });
        return readPage(record.id);
      }),
    update: (_user, id, patch) => refusing(() => updateRecord(caller, id, patch)),
    remove: (_user, id) =>
      refusing(async () => {
        // Already deleted for good: the device held a copy it was never told about, and now forgets it.
        const exists = await db.query.pages.findFirst({ where: eq(pages.id, id), columns: { id: true } });
        if (!exists) return { id, updatedAt: Date.now(), deleted: true, data: null };
        await deletePage(caller, id);
        return readPage(id);
      }),
  };
}

/** A page record's fields written as the sync carries them. */
async function updateRecord(caller: Caller, id: string, patch: Partial<PageRecord>) {
  const current = await authorizePage(caller, id, "write");
  if (patch.parentId !== undefined || patch.sort !== undefined) {
    const parentId = patch.parentId ?? current.parentId;
    if (parentId && (parentId !== current.parentId || patch.sort !== current.sort))
      await movePage(caller, id, parentId, { sort: patch.sort ?? current.sort });
  }
  const input: { -readonly [K in keyof PageInput]: PageInput[K] } = {};
  if (patch.title !== undefined) input.title = patch.title;
  if (patch.icon !== undefined) input.icon = patch.icon;
  if (patch.description !== undefined) input.description = patch.description;
  if (patch.body !== undefined && patch.body !== null) input.body = patch.body;
  if (patch.schema !== undefined) input.schema = patch.schema;
  if (patch.properties !== undefined)
    input.properties = valuesToWrite(current.properties, patch.properties, patch.schema ?? current.schema);
  if (Object.keys(input).length) await updatePage(caller, id, input);
  if (patch.archivedAt !== undefined && !!patch.archivedAt !== !!current.archivedAt)
    await setArchived(caller, id, !!patch.archivedAt);
  return readPage(id);
}

const viewColumns = {
  id: views.id,
  kind: views.kind,
  traits: views.traits,
  filter: views.filter,
  sort: views.sort,
  groupBy: views.groupBy,
  visibleProperties: views.visibleProperties,
  barProperties: views.barProperties,
  sortCode: views.sortCode,
  newParent: views.newParent,
  showArchived: views.showArchived,
  cleanup: views.cleanup,
  syncedAt: views.syncedAt,
};

async function readView(id: string): Promise<Envelope<ViewRecord>> {
  const [row] = await db.select(viewColumns).from(views).where(eq(views.id, id));
  if (!row) return { id, updatedAt: Date.now(), deleted: true, data: null };
  const { syncedAt, ...data } = row;
  return envelope({ id, syncedAt, deleted: false, data });
}

/** A granted record stamped no earlier than its grant, so it wins over a revocation the device already holds. */
const stampedNoEarlier = <T extends { id: string }>(e: Envelope<T>, at: number): Envelope<T> =>
  e.updatedAt >= at ? e : { ...e, updatedAt: at };

/** The workspaces a scope reaches at all, whose tombstones it hears. */
const reached = (scope: Scope) => [...scope.workspaceIds, ...scope.visitorWorkspaceIds];

/** Tombstones of records (comments, pages) deleted outright since `since`, as the deletions they stand for. */
async function buried(model: string, workspaceIds: readonly string[], since: number) {
  if (since === 0 || !workspaceIds.length) return [];
  const rows = await db
    .select()
    .from(tombstones)
    .where(
      and(
        eq(tombstones.model, model),
        inArray(tombstones.workspaceId, [...workspaceIds]),
        gte(tombstones.syncedAt, after(since)),
      ),
    );
  return rows.map((row) => ({ id: row.id, updatedAt: row.syncedAt.getTime(), deleted: true, data: null }));
}

/** Newest first wins: a comment deleted and made again under its id is alive, and the other way round. */
function newest<T extends { id: string }>(envelopes: readonly Envelope<T>[]) {
  const byId = new Map<string, Envelope<T>>();
  for (const e of envelopes) {
    const held = byId.get(e.id);
    if (!held || held.updatedAt <= e.updatedAt) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => a.updatedAt - b.updatedAt);
}

/**
 * A view's query, keyed by its node's id: the node (a page of kind `view`) is made, named, moved and trashed as a
 * page, and comes first in the queue; this is what it shows.
 */
function viewStore(caller: Caller, scope: Scope, revocations: Revocations): SyncedStore<ViewRecord> {
  const write = async ({ id: _id, ...view }: Partial<ViewRecord>, id: string) => {
    await updatePage(caller, id, { view });
    // A rule just saved runs at once; what it archives reaches the device with the next pull.
    if (view.cleanup !== undefined) await cleanupSaved(id, view.cleanup);
    return readView(id);
  };
  return {
    async pull(_user, since) {
      const gone = (await revocations(since))
        .filter((r) => r.kind === null || r.kind === "view")
        .map((r) => revocationEnvelope<ViewRecord>(r));
      if (scopeEmpty(scope)) return newest(gone);
      const grants = grantsSince(scope, since);
      const whole = granted(grants, "page");
      const rows = await db
        .select(viewColumns)
        .from(views)
        .innerJoin(pages, eq(pages.id, views.id))
        .where(
          and(
            inScope(scope),
            whole ? sql`(${gte(views.syncedAt, after(since))} or ${whole})` : gte(views.syncedAt, after(since)),
          ),
        );
      const toEnvelope = ({ syncedAt, ...data }: (typeof rows)[number]) =>
        envelope({ id: data.id, syncedAt, deleted: false, data });
      // Views ride with their nodes: a revoked node's id is also its view's.
      return newest([...rows.map((row) => stampedNoEarlier(toEnvelope(row), grants.at)), ...gone]);
    },
    read: async () => null,
    create: (_user, record) =>
      refusing(async () => {
        const node = await authorizePage(caller, record.id, "write");
        if (node.kind !== "view") throw new RejectedError("That is not a view");
        return write(record, record.id);
      }),
    update: (_user, id, patch) => refusing(() => write(patch, id)),
    remove: (_user, id) =>
      refusing(async () => {
        await deletePage(caller, id);
        return readView(id);
      }),
  };
}

const commentColumns = {
  id: comments.id,
  pageId: comments.pageId,
  workspaceId: comments.workspaceId,
  authorId: comments.authorId,
  replyTo: comments.replyTo,
  body: comments.body,
  createdAt: comments.createdAt,
  editedAt: comments.editedAt,
  syncedAt: comments.syncedAt,
};

type CommentRow = { [K in keyof typeof commentColumns]: (typeof comments.$inferSelect)[K] };

const commentEnvelope = ({ syncedAt, createdAt, editedAt, ...data }: CommentRow) =>
  envelope({
    id: data.id,
    syncedAt,
    deleted: false,
    data: { ...data, createdAt: createdAt.toISOString(), editedAt: editedAt?.toISOString() ?? null },
  });

async function readComment(id: string): Promise<Envelope<CommentRecord>> {
  const [row] = await db.select(commentColumns).from(comments).where(eq(comments.id, id));
  return row ? commentEnvelope(row) : { id, updatedAt: Date.now(), deleted: true, data: null };
}

/** The comments on pages a scope reaches (`"page"` is the comment's page, joined). */
function commentStore(caller: Caller, scope: Scope, revocations: Revocations): SyncedStore<CommentRecord> {
  return {
    async pull(_user, since) {
      const revokedAt = new Map((await revocations(since)).map((r) => [r.id, r.at]));
      const gone = revokedAt.size
        ? (
            await db
              .select({ id: comments.id, pageId: comments.pageId })
              .from(comments)
              .where(inArray(comments.pageId, [...revokedAt.keys()]))
          ).map((row) => revocationEnvelope<CommentRecord>({ id: row.id, at: revokedAt.get(row.pageId) ?? 0 }))
        : [];
      if (scopeEmpty(scope)) return newest(gone);
      const grants = grantsSince(scope, since);
      const whole = granted(grants, "page");
      const fresh = gte(comments.syncedAt, after(since));
      const rows = await db
        .select(commentColumns)
        .from(comments)
        .innerJoin(pages, eq(pages.id, comments.pageId))
        .where(and(inScope(scope), whole ? sql`(${fresh} or ${whole})` : fresh));
      return newest([
        ...rows.map((row) => stampedNoEarlier(commentEnvelope(row), grants.at)),
        ...gone,
        ...(await buried("comments", reached(scope), since)),
      ]);
    },
    read: async () => null,
    create: (_user, { id, pageId, body, replyTo }) =>
      refusing(async () => {
        await saveComment(caller, id, pageId, body, replyTo ?? null);
        await db.delete(tombstones).where(and(eq(tombstones.model, "comments"), eq(tombstones.id, id)));
        return readComment(id);
      }),
    update: (_user, id, { body }) =>
      refusing(async () => {
        if (body !== undefined) await updateComment(caller, id, body);
        return readComment(id);
      }),
    remove: (_user, id) =>
      refusing(async () => {
        const existing = await db.query.comments.findFirst({ where: eq(comments.id, id), columns: { id: true } });
        if (existing) await deleteComment(caller, id);
        return readComment(id);
      }),
  };
}

const reactionColumns = {
  id: commentReactions.id,
  commentId: commentReactions.commentId,
  pageId: commentReactions.pageId,
  workspaceId: commentReactions.workspaceId,
  authorId: commentReactions.peopleId,
  emoji: commentReactions.emoji,
  createdAt: commentReactions.createdAt,
  syncedAt: commentReactions.syncedAt,
};

type ReactionRow = Omit<typeof commentReactions.$inferSelect, "peopleId"> & { authorId: string };

const reactionEnvelope = ({ syncedAt, createdAt, ...data }: ReactionRow) =>
  envelope<ReactionRecord>({
    id: data.id,
    syncedAt,
    deleted: false,
    data: { ...data, createdAt: createdAt.toISOString() },
  });

/** The caller's own reaction under an id: someone else's (an id clash) reads as gone, so a write never shows it. */
async function readReaction(caller: Caller, id: string): Promise<Envelope<ReactionRecord>> {
  const [row] = await db.select(reactionColumns).from(commentReactions).where(eq(commentReactions.id, id));
  return row?.authorId === authorId(caller)
    ? reactionEnvelope(row)
    : { id, updatedAt: Date.now(), deleted: true, data: null };
}

/** Reactions ride with their comments: the ones on pages a scope reaches (`"page"` is the reaction's page, joined). */
function reactionStore(caller: Caller, scope: Scope, revocations: Revocations): SyncedStore<ReactionRecord> {
  return {
    async pull(_user, since) {
      const revokedAt = new Map((await revocations(since)).map((r) => [r.id, r.at]));
      const gone = revokedAt.size
        ? (
            await db
              .select({ id: commentReactions.id, pageId: commentReactions.pageId })
              .from(commentReactions)
              .where(inArray(commentReactions.pageId, [...revokedAt.keys()]))
          ).map((row) => revocationEnvelope<ReactionRecord>({ id: row.id, at: revokedAt.get(row.pageId) ?? 0 }))
        : [];
      if (scopeEmpty(scope)) return newest(gone);
      const grants = grantsSince(scope, since);
      const whole = granted(grants, "page");
      const fresh = gte(commentReactions.syncedAt, after(since));
      const rows = await db
        .select(reactionColumns)
        .from(commentReactions)
        .innerJoin(pages, eq(pages.id, commentReactions.pageId))
        .where(and(inScope(scope), whole ? sql`(${fresh} or ${whole})` : fresh));
      return newest([
        ...rows.map((row) => stampedNoEarlier(reactionEnvelope(row), grants.at)),
        ...gone,
        ...(await buried("reactions", reached(scope), since)),
      ]);
    },
    read: async () => null,
    create: (_user, { id, commentId, emoji }) =>
      refusing(async () => {
        const made = await addReaction(caller, id, commentId, emoji);
        if (made) await db.delete(tombstones).where(and(eq(tombstones.model, "reactions"), eq(tombstones.id, id)));
        // Already there under another id (a second device): this one is dropped, and the one kept syncs down.
        return readReaction(caller, id);
      }),
    // A reaction is put on or taken off, never changed.
    update: (_user, id) => refusing(() => readReaction(caller, id)),
    remove: (_user, id) =>
      refusing(async () => {
        await removeReaction(caller, id);
        return readReaction(caller, id);
      }),
  };
}

type NotificationRow = typeof notifications.$inferSelect;

const notificationEnvelope = (row: NotificationRow): Envelope<NotificationRecord> =>
  envelope({
    id: row.id,
    syncedAt: row.syncedAt,
    deleted: false,
    data: {
      id: row.id,
      type: row.type,
      title: row.title,
      text: row.text,
      url: row.url,
      workspaceId: row.workspaceId,
      pageId: row.pageId,
      commentId: row.commentId,
      actor: row.actor,
      client: row.client,
      data: { ...row.data },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    },
  });

/** How far back a device's first pull of the inbox reaches, and how much of it. */
const INBOX_DAYS = 30;
const INBOX_FIRST_PULL = 300;

/**
 * The caller's own notifications (by their People id), wherever they are: a visitor with shares only has an inbox too.
 * One deleted outright (undone edits, a purged page, retention) comes as a deletion, from its tombstone.
 */
function notificationStore(caller: Caller): SyncedStore<NotificationRecord> {
  const mine = eq(notifications.recipient, authorId(caller));
  const read = async (id: string): Promise<Envelope<NotificationRecord>> => {
    const [row] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), mine));
    if (!row) return { id, updatedAt: Date.now(), deleted: true, data: null };
    return notificationEnvelope(row);
  };
  return {
    async pull(_user, since) {
      const buried =
        since === 0
          ? []
          : await db
              .select({ id: notificationTombstones.id, syncedAt: notificationTombstones.syncedAt })
              .from(notificationTombstones)
              .where(
                and(
                  eq(notificationTombstones.recipient, authorId(caller)),
                  gte(notificationTombstones.syncedAt, after(since)),
                ),
              );
      const rows =
        since === 0
          ? await db
              .select()
              .from(notifications)
              .where(and(mine, sql`${notifications.createdAt} > now() - make_interval(days => ${INBOX_DAYS})`))
              .orderBy(desc(notifications.createdAt))
              .limit(INBOX_FIRST_PULL)
          : await db
              .select()
              .from(notifications)
              .where(and(mine, gte(notifications.syncedAt, after(since))));
      const gone = buried.map((t) => ({ id: t.id, updatedAt: t.syncedAt.getTime(), deleted: true, data: null }));
      return [...rows.map(notificationEnvelope), ...gone].sort((a, b) => a.updatedAt - b.updatedAt);
    },
    read: async () => null,
    create: async () => {
      throw new RejectedError("Notifications are Keep's to write");
    },
    // Only `readAt` is the person's to change: read (stamped now) or unread again.
    update: async (_user, id, { readAt }) => {
      if (readAt !== undefined)
        await db
          .update(notifications)
          .set({ readAt: readAt === null ? null : sql`now()` })
          .where(and(eq(notifications.id, id), mine));
      return read(id);
    },
    remove: async () => {
      throw new RejectedError("Notifications are Keep's to write");
    },
  };
}

/** The pages the caller watches themself (their untagged watches), keyed by page id; unwatching syncs as a deletion. */
function watchStore(caller: Caller): SyncedStore<WatchRecord> {
  const mine = and(eq(pageWatches.peopleId, authorId(caller)), isNull(pageWatches.client));
  const toEnvelope = (row: typeof pageWatches.$inferSelect): Envelope<WatchRecord> =>
    envelope({
      id: row.pageId,
      syncedAt: row.syncedAt,
      deleted: !!row.deletedAt,
      data: { id: row.pageId, createdAt: row.createdAt.toISOString() },
    });
  const read = async (pageId: string) => {
    const [row] = await db
      .select()
      .from(pageWatches)
      .where(and(mine, eq(pageWatches.pageId, pageId)));
    return row ? toEnvelope(row) : { id: pageId, updatedAt: Date.now(), deleted: true, data: null };
  };
  return {
    async pull(_user, since) {
      const rows = await db
        .select()
        .from(pageWatches)
        .where(
          and(mine, gte(pageWatches.syncedAt, after(since)), since === 0 ? isNull(pageWatches.deletedAt) : undefined),
        );
      return rows.map(toEnvelope);
    },
    read: async () => null,
    create: (_user, { id }) =>
      refusing(async () => {
        await watchPage(caller, id, null);
        return read(id);
      }),
    update: (_user, id) => refusing(() => read(id)),
    remove: (_user, id) =>
      refusing(async () => {
        await unwatchPage(caller, id, null);
        return read(id);
      }),
  };
}

const mutationLog = {
  async seen(author: string, ids: readonly string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await db
      .select({ id: mutations.mutationId })
      .from(mutations)
      .where(and(eq(mutations.authorId, author), inArray(mutations.mutationId, [...ids])));
    return new Set(rows.map((r) => r.id));
  },
  async remember(author: string, ids: readonly string[]) {
    await db
      .insert(mutations)
      .values(ids.map((mutationId) => ({ authorId: author, mutationId })))
      .onConflictDoNothing();
    // Forgetting the old ones on the way costs one indexed delete, and keeps the log from growing forever.
    await db
      .delete(mutations)
      .where(
        and(
          eq(mutations.authorId, author),
          lt(mutations.createdAt, sql`now() - make_interval(days => ${REMEMBER_DAYS})`),
        ),
      );
  },
};

/**
 * Marks the pages a device holds that no longer exist (deleted for good before deletions left tombstones), so its next
 * pull takes them off: a device asks once a session with what it holds, in the caller's workspaces only.
 */
export async function buryGone(caller: Caller, held: readonly { id: string; workspaceId: string }[]) {
  const scope = await scopeOf(accountId(caller));
  const workspaceIds = new Set(reached(scope));
  if (!held.length) return { buried: 0 };
  const existing = await db
    .select({ id: pages.id, workspaceId: pages.workspaceId, holdable: holdable(scope) })
    .from(pages)
    .where(
      inArray(
        pages.id,
        held.map((page) => page.id),
      ),
    );
  // Held but no longer readable (a share taken back while the device was away): taken off by its next pull. Only in a
  // workspace the account reaches or once held something in, so a device cannot list what sits under any page it names.
  const history = await db
    .selectDistinct({ workspaceId: syncRevocations.workspaceId })
    .from(syncRevocations)
    .where(eq(syncRevocations.personId, scope.accountId));
  const plausible = new Set([...workspaceIds, ...history.map((row) => row.workspaceId)]);
  const unreadable = existing.filter((row) => !row.holdable && plausible.has(row.workspaceId ?? row.id));
  for (const row of unreadable) await revokeSync(db, scope.accountId, row.id, row.workspaceId ?? row.id);
  const live = new Set(existing.map((row) => row.id));
  const mine = held.filter((page) => workspaceIds.has(page.workspaceId));
  const gone = mine.filter((page) => !live.has(page.id));
  if (gone.length)
    await db
      .insert(tombstones)
      .values(gone.map((page) => ({ model: "pages", id: page.id, workspaceId: page.workspaceId })))
      .onConflictDoUpdate({ target: [tombstones.model, tombstones.id], set: { syncedAt: sql`now()` } });
  return { buried: gone.length + unreadable.length };
}

export async function sync(caller: Caller, request: SyncRequest) {
  const scope = await scopeOf(accountId(caller));
  const asked = new Map<number, Promise<Revoked>>();
  const revocations: Revocations = (since) => {
    const known = asked.get(since) ?? revoked(scope, since);
    asked.set(since, known);
    return known;
  };
  const server = new SyncServer(
    [
      syncedModel({
        name: "pages",
        schema: pageRecordSchema,
        store: pageStore(caller, scope, revocations),
        actions: {
          // Many pages moved as one write; sent to (and answered as) one of them.
          move: action(movePayloadSchema, (_user, id, { moves }) =>
            refusing(async () => {
              await movePages(caller, moves);
              return readPage(id);
            }),
          ),
          // A trait's properties changed and its pages following; an undo also puts its pages back as they were.
          trait: action(traitPayloadSchema, (_user, id, { properties, renames, drop, dropFromPages, restore }) =>
            refusing(async () => {
              await updateTrait(caller, id, { properties, renames, drop, dropFromPages });
              for (const [pageId, page] of Object.entries(restore ?? {}))
                await updateRecord(caller, pageId, page as Partial<PageRecord>);
              return readPage(id);
            }),
          ),
        },
      }),
      syncedModel({ name: "views", schema: viewRecordSchema, store: viewStore(caller, scope, revocations) }),
      syncedModel({ name: "comments", schema: commentRecordSchema, store: commentStore(caller, scope, revocations) }),
      syncedModel({
        name: "reactions",
        schema: reactionRecordSchema,
        store: reactionStore(caller, scope, revocations),
      }),
      syncedModel({
        name: "notifications",
        schema: notificationRecordSchema,
        store: notificationStore(caller),
      }),
      syncedModel({ name: "watches", schema: watchRecordSchema, store: watchStore(caller) }),
    ],
    mutationLog,
  );
  return server.handle(accountId(caller), request);
}

/** The newest write in the workspaces a scope reaches, as the database's own text so no precision is lost. */
async function newestWrite(workspaceIds: readonly string[]): Promise<string | null> {
  if (!workspaceIds.length) return null;
  const within = uuidList(workspaceIds);
  const rows = await db.execute<{ newest: string | null }>(sql`
    select greatest(
      (select max("synced_at") from "page" where "workspace_id" in (${within})),
      (select max("view"."synced_at") from "view" join "page" on "page"."id" = "view"."id" where "page"."workspace_id" in (${within})),
      (select max("synced_at") from "comment" where "workspace_id" in (${within})),
      (select max("synced_at") from "comment_reaction" where "workspace_id" in (${within})),
      (select max("synced_at") from "sync_tombstone" where "workspace_id" in (${within}))
    )::text as "newest"`);
  return rows[0]?.newest ?? null;
}

const LIVE_CHECK_MS = 2_000;
const LIVE_HEARTBEAT_MS = 20_000;
/** A stream ends after this and the device opens another, so its scope follows memberships and shares. */
const LIVE_LIFETIME_MS = 5 * 60_000;

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Says when something changed in the caller's workspaces, so a device pulls at once rather than on its timer. Only a
 * nudge: what changed, and whether the caller may see it, is still the pull's to answer.
 */
export async function* liveChanges(caller: Caller, signal: AbortSignal) {
  const scope = await scopeOf(accountId(caller));
  const workspaceIds = reached(scope);
  let last = await newestWrite(workspaceIds);
  yield { changed: false };
  const end = Date.now() + LIVE_LIFETIME_MS;
  let heartbeat = Date.now() + LIVE_HEARTBEAT_MS;
  while (!signal.aborted && Date.now() < end) {
    await pause(LIVE_CHECK_MS, signal);
    if (signal.aborted) return;
    const newest = await newestWrite(workspaceIds);
    if (newest !== last) {
      last = newest;
      yield { changed: true };
    } else if (Date.now() >= heartbeat) {
      heartbeat = Date.now() + LIVE_HEARTBEAT_MS;
      yield { changed: false };
    }
  }
}
