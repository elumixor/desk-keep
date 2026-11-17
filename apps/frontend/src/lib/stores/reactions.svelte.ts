import { reactionRecords } from "../sync/client.svelte";
import { local } from "../sync/local.svelte";
import { me } from "./me.svelte";

/** Emoji on comments, written to the synced records: one per person and emoji, put on and taken off by the same click. */
class Reactions {
  /** Whether the signed-in person has put this emoji on the comment. */
  mine(commentId: string, emoji: string) {
    const self = me.current?.peopleId;
    return (
      !!self &&
      !!local
        .reactionsOf(commentId)
        .get(emoji)
        ?.some((r) => r.authorId === self)
    );
  }

  toggle(commentId: string, emoji: string) {
    const self = me.current?.peopleId;
    if (!self) return;
    const mine = local
      .reactionsOf(commentId)
      .get(emoji)
      ?.find((r) => r.authorId === self);
    if (mine) reactionRecords.delete(mine.id);
    else reactionRecords.create({ commentId, emoji, authorId: self, createdAt: new Date().toISOString() });
  }
}

export const reactions = new Reactions();
