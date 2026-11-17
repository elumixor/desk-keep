import type { ChangeItem, NotificationType } from "~/model/watch";
import { appUrl } from "../env";

/** Where a notification opens: the page (the workspace for an invite), scrolled to the comment when it is about one. */
export const deepLink = (workspaceId: string, pageId: string, commentId?: string | null) =>
  `${appUrl}/w/${workspaceId}${pageId === workspaceId ? "" : `/p/${pageId}`}${commentId ? `#comment-${commentId}` : ""}`;

const TEXT_MAX = 200;

export const clipText = (text: string, max = TEXT_MAX) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** People takes a title of up to 300 characters: the page and the actor are clipped so the longest one fits. */
const PAGE_TITLE_MAX = 180;
const ACTOR_MAX = 80;
/** People takes up to 200 changes and 20000 characters of text; a watch keeps fewer, folding the rest into a count. */
export const CHANGES_MAX = 50;
const TEXT_LIMIT = 20_000;

export const named = (title: string) => clipText(title, PAGE_TITLE_MAX) || "Untitled";
const who = (actor: string) => clipText(actor, ACTOR_MAX);

/** A direct notification's title: who did what, where. */
export function directTitle(
  type: Exclude<NotificationType, "watch">,
  name: string,
  pageTitle: string,
  assigned = false,
) {
  const actor = who(name);
  switch (type) {
    case "mention":
      return assigned ? `${actor} assigned you ${named(pageTitle)}` : `${actor} mentioned you in ${named(pageTitle)}`;
    case "reply":
      return `${actor} replied to your comment on ${named(pageTitle)}`;
    case "share":
      return `${actor} shared ${named(pageTitle)} with you`;
    case "invite":
      return `${actor} added you to ${named(pageTitle)}`;
  }
}

/** A watch's title: by whom while one person made every change, else just the page. */
export const watchTitle = (pageTitle: string, actor: string | null) =>
  actor ? `${who(actor)} changed ${named(pageTitle)}` : `${named(pageTitle)} changed`;

/** A watch's text: a line per change, and how many more there were. */
export const changesText = (changes: readonly ChangeItem[], more = 0) =>
  [...changes.map((c) => `- ${c.summary}`), ...(more ? [`- And ${more} more`] : [])].join("\n").slice(0, TEXT_LIMIT);
