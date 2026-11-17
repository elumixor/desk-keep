import { watchRecords } from "../sync/client.svelte";

/** The pages the signed-in person watches themself (synced): told of their changes in the inbox and through People. */
class Watches {
  isWatching(pageId: string) {
    return !!watchRecords.get(pageId);
  }

  toggle(pageId: string) {
    if (this.isWatching(pageId)) watchRecords.delete(pageId);
    else watchRecords.create({ id: pageId, createdAt: new Date().toISOString() });
  }
}

export const watches = new Watches();
