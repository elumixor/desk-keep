import { model, type Signals, syncedClient } from "@elumixor/synced/client";
import type { SyncResponse } from "@elumixor/synced/protocol";
import type {
  CommentRecord,
  MovePayload,
  NotificationRecord,
  PageRecord,
  ReactionRecord,
  ViewRecord,
  WatchRecord,
} from "$model/sync";
import { followed, type TraitPayload, traitInverse } from "$model/traits";
import { api } from "../api";
import { notices } from "../stores/notices.svelte";
import { IdbStorage } from "./storage";

/**
 * Every node (page, trait, view), view query, comment and reaction of the signed-in person's workspaces, and their
 * inbox and watches, on the device. Screens
 * read these and write to them; `@elumixor/synced` draws a write at once, keeps it queued (on disk too) until the
 * server takes it, retries when it could not be reached, and folds in what changed elsewhere. What a screen sees is
 * the server's records with the writes it has not acknowledged yet on top.
 */
/** Where each page of a `move` goes, keyed by page id. */
type Moves = MovePayload["moves"];

const models = {
  pages: model<PageRecord>()({
    actions: {
      // Many pages moved as one write: drawn on each of them at once, undone by moving each back.
      move: {
        targets: ({ moves }: { moves: Moves }) => Object.keys(moves),
        optimistic: (page: PageRecord, { moves }: { moves: Moves }) => moves[page.id] ?? {},
        invert: (page: PageRecord, { moves }: { moves: Moves }, find: (id: string) => PageRecord | undefined) => {
          const back = Object.keys(moves).flatMap((id) => {
            const now = find(id);
            return now?.parentId ? [[id, { parentId: now.parentId, sort: now.sort }] as const] : [];
          });
          return {
            kind: "action",
            model: "pages",
            id: page.id,
            name: "move",
            payload: { moves: Object.fromEntries(back) },
          };
        },
      },
      // A trait's properties changed: drawn on the trait and every page having it, undone by putting them back.
      trait: {
        targets: ({ nodes }: TraitPayload) => nodes,
        optimistic: (record: PageRecord, payload: TraitPayload) =>
          record.id === payload.nodes[0] ? { schema: payload.properties } : followed(record, payload),
        invert: (trait: PageRecord, payload: TraitPayload, find: (id: string) => PageRecord | undefined) => ({
          kind: "action",
          model: "pages",
          id: trait.id,
          name: "trait",
          payload: traitInverse(trait, payload, find),
        }),
      },
    },
  }),
  views: model<ViewRecord>()(),
  comments: model<CommentRecord>()({ compare: (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") }),
  reactions: model<ReactionRecord>()({ compare: (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") }),
  // The signed-in person's own: their inbox, newest first, and the pages they watch.
  notifications: model<NotificationRecord>()({ compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt) }),
  watches: model<WatchRecord>()(),
};

/** `$state.raw` in a box: the records are replaced, never mutated, so nothing in them needs a deep proxy. */
class Cell<T> {
  value = $state.raw() as T;

  constructor(initial: T) {
    this.value = initial;
  }
}

const signals: Signals = { state: <T>(initial: T) => new Cell(initial) };

/** Bumped when the stored shape of a record changes, so a copy an older build wrote is not read into a newer one. */
const PREFIX = "keep:synced:v5";
const OWNER = `${PREFIX}:owner`;
/** How often a visible tab asks what changed elsewhere, should the live stream be down. */
const PULL_MS = 30_000;

const storage = new IdbStorage();

export const synced = syncedClient({
  models,
  prefix: PREFIX,
  storage,
  signals,
  transport: (request) => api.sync.$post(request) as Promise<SyncResponse>,
  onRejected: (rejected) => notices.show(rejected.reason, "error"),
});

let started: Promise<void> | null = null;

/**
 * Puts the device's copy on screen and starts syncing, once there is a signed-in person. A copy that belonged to
 * somebody else is wiped first rather than shown.
 */
export function startSync(userId: string) {
  started ??= (async () => {
    await storage.preload();
    if (storage.readSync(OWNER) !== userId) {
      await synced.clear();
      await storage.write(OWNER, userId);
    }
    await synced.hydrate();
    void synced.ensure().then(reconcile);
    addEventListener("online", () => void synced.sync());
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void synced.sync();
    });
    setInterval(() => {
      if (document.visibilityState === "visible") void synced.sync();
    }, PULL_MS);
    void listen();
  })();
  return started;
}

const RETRY_MS = 5_000;
const SETTLE_MS = 200;

const visible = () =>
  new Promise<void>((resolve) => {
    if (document.visibilityState === "visible") return resolve();
    addEventListener("visibilitychange", function check() {
      if (document.visibilityState !== "visible") return;
      removeEventListener("visibilitychange", check);
      resolve();
    });
  });

/** While the tab is visible, keeps a stream open that says when something changed elsewhere, and pulls on each. */
async function listen() {
  let settling: ReturnType<typeof setTimeout> | undefined;
  while (true) {
    await visible();
    const stream = api.sync.live.$get();
    const hidden = () => {
      if (document.visibilityState !== "visible") stream.abort();
    };
    addEventListener("visibilitychange", hidden);
    try {
      for await (const { changed } of stream) {
        if (!changed) continue;
        clearTimeout(settling);
        settling = setTimeout(() => void synced.sync(), SETTLE_MS);
      }
      await stream.done;
    } catch {
      // Down or offline: the timer still pulls, and this tries again.
      if (document.visibilityState === "visible") await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    } finally {
      removeEventListener("visibilitychange", hidden);
    }
  }
}

/**
 * Once a session, after the first sync: the pages this device holds are checked against the server, and the ones gone
 * for good (without a tombstone to say so) are taken off with the next sync. Skipped while writes are unsent.
 */
async function reconcile() {
  if (synced.pendingCount) return;
  const held = pageRecords.all.map((page) => ({ id: page.id, workspaceId: page.workspaceId ?? page.id }));
  try {
    const { buried } = await api.sync.gone.$post({ pages: held });
    if (buried) await synced.sync();
  } catch (error) {
    console.warn("[sync] reconcile", error);
  }
}

/** Signing out takes the records off the device with the session. */
export async function stopSync() {
  await synced.clear();
  await storage.remove(OWNER);
}

export const pageRecords = synced.models.pages;
export const viewRecords = synced.models.views;
export const commentRecords = synced.models.comments;
export const reactionRecords = synced.models.reactions;
export const notificationRecords = synced.models.notifications;
export const watchRecords = synced.models.watches;
