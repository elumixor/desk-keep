import { z } from "zod";
import { docSchema } from "./document";
import { ICON_MAX } from "./icons";
import { DESCRIPTION_MAX, NODE_KINDS } from "./nodes";
import { type PropertyValues, schemaSchema } from "./properties";
import { cleanupSchema, filterSchema, sortSchema, VIEW_KINDS } from "./views";
import { NOTIFICATION_TYPES } from "./watch";

/**
 * The records the app keeps on the device and writes through one queue (`@elumixor/synced`): every node (page, trait,
 * view) and view query, comment and reaction of the caller's workspaces. The server owns a page's `workspaceId` and the times; a client's value for
 * them is ignored.
 */
export const pageRecordSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  workspaceId: z.uuid().nullable().optional(),
  kind: z.enum(NODE_KINDS).default("page"),
  title: z.string().max(500),
  icon: z.string().max(ICON_MAX).nullable(),
  /** One line under the title; empty when none. */
  description: z.string().max(DESCRIPTION_MAX).default(""),
  body: docSchema.nullable(),
  properties: z.record(z.string(), z.unknown()),
  /** Its properties; a trait's are what its pages have. */
  schema: schemaSchema,
  /** Ids of the traits whose properties it has: worked out by the server (and on the device), never written. */
  traits: z.array(z.uuid()).default([]),
  sort: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  /** When it was archived (out of the tree and views, kept on the device); null when it is not. Stamped by the server. */
  archivedAt: z.string().nullable().optional(),
});
export type PageRecord = Omit<z.infer<typeof pageRecordSchema>, "properties"> & { properties: PropertyValues };

/** The `move` action: many pages moved at once, each to its parent and place, as one write. */
export const movePayloadSchema = z.object({
  moves: z.record(z.uuid(), z.object({ parentId: z.uuid(), sort: z.number() })),
});
export type MovePayload = z.infer<typeof movePayloadSchema>;

/** A view node's query, under the node's id; its name, icon and place are the node's. */
export const viewRecordSchema = z.object({
  id: z.uuid(),
  kind: z.enum(VIEW_KINDS),
  traits: z.array(z.uuid()),
  filter: z.array(filterSchema),
  sort: z.array(sortSchema),
  groupBy: z.string().nullable(),
  visibleProperties: z.array(z.string()).nullable(),
  barProperties: z.array(z.string()).nullable().default(null),
  sortCode: z.string().max(10_000).nullable().default(null),
  newParent: z.uuid().nullable(),
  showArchived: z.boolean().default(false),
  cleanup: cleanupSchema.nullable().default(null),
});
export type ViewRecord = z.infer<typeof viewRecordSchema>;

const COMMENT_MAX = 10_000;

/** A comment is written on a page by the caller; the server owns its workspace, author and times. */
export const commentRecordSchema = z.object({
  id: z.uuid(),
  pageId: z.uuid(),
  body: z.string().trim().min(1).max(COMMENT_MAX),
  /** The comment on the same page it answers; set when written, never changed. */
  replyTo: z.uuid().nullable().default(null),
  workspaceId: z.uuid().optional(),
  /** The author's People person id. */
  authorId: z.uuid().optional(),
  createdAt: z.string().optional(),
  editedAt: z.string().nullable().optional(),
});
export type CommentRecord = z.infer<typeof commentRecordSchema>;

export const REACTION_EMOJI_MAX = 32;

/**
 * One emoji and nothing else: a pictograph (with its skin tone, presentation selector, tags and ZWJ parts), a flag (two
 * regional indicators) or a keycap. Not a custom one or an icon (those are ASCII: `lucide:…`, `custom:…`).
 */
const ONE_EMOJI =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\u{fe0f}?\u{20e3})(?:\u{fe0f}|\p{Emoji_Modifier}|[\u{e0020}-\u{e007f}]|\u{200d}\p{Extended_Pictographic}\u{fe0f}?)*$/u;

export const reactionEmojiSchema = z.string().min(1).max(REACTION_EMOJI_MAX).regex(ONE_EMOJI, "Not an emoji");

/** An emoji somebody put on a comment; the server owns its page, workspace, author (a People id) and time. */
export const reactionRecordSchema = z.object({
  id: z.uuid(),
  commentId: z.uuid(),
  emoji: reactionEmojiSchema,
  pageId: z.uuid().optional(),
  workspaceId: z.uuid().optional(),
  authorId: z.uuid().optional(),
  createdAt: z.string().optional(),
});
export type ReactionRecord = z.infer<typeof reactionRecordSchema>;

/**
 * One of the signed-in person's notifications (their inbox): Keep writes them, the person only marks them read
 * (`readAt`, stamped by the server).
 */
export const notificationRecordSchema = z.object({
  id: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  text: z.string().nullable(),
  url: z.string(),
  workspaceId: z.uuid(),
  pageId: z.uuid(),
  commentId: z.uuid().nullable(),
  /** Who did it: a People id. */
  actor: z.uuid().nullable(),
  client: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  readAt: z.string().nullable(),
});
/** `data` is a `NotificationData`. */
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

/** A page the signed-in person watches themself, keyed by the page's id. */
export const watchRecordSchema = z.object({ id: z.uuid(), createdAt: z.string().optional() });
export type WatchRecord = z.infer<typeof watchRecordSchema>;

/** A trait as screens read it: a node of kind `trait`, named by its title, its properties its schema. */
export interface TraitRecord {
  readonly id: string;
  readonly workspaceId: string | null | undefined;
  readonly parentId: string | null;
  readonly name: string;
  readonly icon: string | null;
  readonly properties: PageRecord["schema"];
}

export const asTrait = (page: PageRecord): TraitRecord => ({
  id: page.id,
  workspaceId: page.workspaceId,
  parentId: page.parentId,
  name: page.title,
  icon: page.icon,
  properties: page.schema,
});
