import { commentRecords } from "../sync/client.svelte";
import { me } from "./me.svelte";

/**
 * Comments on pages, written to the synced records: they show at once, and the server fills in the workspace, the
 * author and the times when it takes them. The author is drawn from who is signed in until then.
 */
class Comments {
  /** `replyTo`: the comment on the page it answers. */
  add(pageId: string, body: string, replyTo: string | null = null) {
    const author = me.current;
    return commentRecords.create({
      pageId,
      body: body.trim(),
      replyTo,
      authorId: author?.peopleId,
      createdAt: new Date().toISOString(),
      editedAt: null,
    });
  }

  edit(id: string, body: string) {
    commentRecords.update(id, { body: body.trim(), editedAt: new Date().toISOString() });
  }

  remove(id: string) {
    commentRecords.delete(id);
  }
}

export const comments = new Comments();
