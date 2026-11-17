import { type DiffLine, diffSnapshots, type Skipped, type Snapshot } from "./history";
import type { PropertyValues, Schema } from "./properties";

/**
 * What Keep tells people (notifications, delivered through People) and other apps (webhooks) about: shared by the
 * server, which writes them, and the app, which shows the inbox and picks a webhook's events.
 */

/** Why somebody is notified: named somewhere, answered, given a page or a workspace, or a page they watch changed. */
export const NOTIFICATION_TYPES = ["mention", "reply", "watch", "share", "invite"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** What a webhook can be sent. */
export const EVENTS = [
  "page.created",
  "page.changed",
  "page.deleted",
  "comment.created",
  "comment.changed",
  "comment.deleted",
] as const;
export type EventType = (typeof EVENTS)[number];

export const CHANGE_KINDS = [
  "title",
  "body",
  "property",
  "comment",
  "child-added",
  "child-removed",
  "trashed",
  "restored",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** One thing that changed on a page, in a line a person reads. */
export interface ChangeItem {
  readonly kind: ChangeKind;
  /** The property's name, for `property`. */
  readonly name?: string;
  readonly summary: string;
}

/** Changes to what is written on the page itself; the rest (comments, subpages, the trash) happen around it. */
const CONTENT_KINDS: readonly ChangeKind[] = ["title", "body", "property"];
export const isContentChange = (item: ChangeItem) => CONTENT_KINDS.includes(item.kind);

/** What a notification carries besides its title and text. */
export interface NotificationData {
  readonly mention?: "body" | "title" | "property" | "comment";
  readonly property?: string;
  readonly role?: string;
  readonly changes?: readonly ChangeItem[];
  /** How many changes a watch had beyond `changes`, told as "and N more". */
  readonly more?: number;
  /** A watch's cursor for `read_page` `since`: what changed since the first change it tells of. */
  readonly since?: string;
  /** The client tag of the write that made it, for information only (a watch's own tag is `client`). */
  readonly via?: string;
}

/** Changes to one watcher's page within this long of the first are told as one notification. */
export const WATCH_WINDOW_MS = 60_000;

/**
 * What a webhook receives (version 2). Every field of version 1 (`type`, `urn`, `workspace`, `changed`, `schema`,
 * `traits`, `properties`) means what it did: for a page event `urn` is the page. A hint, not the truth: a consumer
 * may re-read the page over the API.
 */
export interface KeepEvent {
  readonly version: 2;
  /** The event's id, the same for every hook it goes to. */
  readonly id: string;
  readonly ts: string;
  readonly type: EventType;
  /** What it is about: `keep:page/<id>`, or `keep:comment/<id>` for a comment event. */
  readonly urn: string;
  readonly page: string;
  readonly workspace: string;
  /** Who wrote it: `people:person/<id>`. */
  readonly actor?: string;
  /** The client the write came through (`x-keep-client`). */
  readonly client?: string;
  /** The input keys the write named. */
  readonly changed: readonly string[];
  readonly changes: readonly ChangeItem[];
  /** Page events (`page.deleted` too): the page's title. */
  readonly title?: string;
  /** Page events (`page.deleted` too): the id of the page it sits under, null for a workspace. */
  readonly parentId?: string | null;
  /** Page events (not `page.deleted`): every property it has, the names of its traits, its own values by name. */
  readonly schema?: Schema;
  readonly traits?: readonly string[];
  readonly properties?: PropertyValues;
  readonly comment?: {
    readonly id: string;
    readonly body: string;
    readonly author?: string;
    readonly replyTo?: string | null;
  };
}

/** A page's values as words, by property name (`lib/pages/readable.ts` on the server). */
export type Readable = (schema: Schema, values: PropertyValues) => Record<string, string>;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const LINE_MAX = 80;
const VALUE_MAX = 60;

const changedLines = (body: readonly (DiffLine | Skipped)[]) =>
  body.filter((line): line is DiffLine => "change" in line && line.change !== "kept");

/** What changed from `before` to `after`, as the lines a notification or a webhook tells. */
export function pageChanges(before: Snapshot, after: Snapshot, readable?: Readable): ChangeItem[] {
  const diff = diffSnapshots(before, after, 0);
  const out: ChangeItem[] = [];
  if (before.title !== after.title)
    out.push({ kind: "title", summary: `Renamed "${before.title || "Untitled"}" → "${after.title || "Untitled"}"` });
  if (diff.icon) out.push({ kind: "title", summary: "Icon changed" });
  const lines = changedLines(diff.body);
  if (lines.length) {
    const added = lines.filter((l) => l.change === "added");
    const removed = lines.length - added.length;
    const first = added.find((l) => l.text.trim());
    out.push({
      kind: "body",
      summary: `Body: +${added.length} −${removed} lines${first ? `: "${clip(first.text, LINE_MAX)}"` : ""}`,
    });
  }
  const was = readable?.(before.schema, before.properties) ?? {};
  const is = readable?.(after.schema, after.properties) ?? {};
  for (const change of diff.properties) {
    const name = change.name;
    if (!change.before) out.push({ kind: "property", name, summary: `Added property ${name}` });
    else if (!change.after) out.push({ kind: "property", name, summary: `Removed property ${name}` });
    else {
      const from = was[name] ?? (change.before.value == null ? "" : null);
      const to = is[name] ?? (change.after.value == null ? "" : null);
      out.push({
        kind: "property",
        name,
        summary:
          from === null || to === null
            ? `${name} changed`
            : `${name}: ${clip(from, VALUE_MAX) || "empty"} → ${clip(to, VALUE_MAX) || "empty"}`,
      });
    }
  }
  return out;
}
