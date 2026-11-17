import type { NotificationRecord } from "$model/sync";
import type { NotificationData } from "$model/watch";
import { notificationRecords } from "../sync/client.svelte";

/** The notifications about one page, newest first. */
export interface InboxGroup {
  readonly pageId: string;
  readonly workspaceId: string;
  readonly items: readonly NotificationRecord[];
  readonly unread: number;
}

/** The signed-in person's notifications (synced, their own only): grouped by page, marked read here. */
class Inbox {
  readonly all = $derived(notificationRecords.all);
  readonly unread = $derived(this.all.filter((n) => !n.readAt).length);

  /** Groups by page, the one changed last first. */
  readonly groups = $derived.by(() => {
    const byPage = new Map<string, NotificationRecord[]>();
    for (const n of this.all) {
      const list = byPage.get(n.pageId);
      if (list) list.push(n);
      else byPage.set(n.pageId, [n]);
    }
    return [...byPage].map(
      ([pageId, items]): InboxGroup => ({
        pageId,
        workspaceId: items[0].workspaceId,
        items,
        unread: items.filter((n) => !n.readAt).length,
      }),
    );
  });

  /** What changed, for a watch: its lines. */
  changes(n: NotificationRecord) {
    return (n.data as NotificationData).changes ?? [];
  }

  read(id: string) {
    const n = notificationRecords.get(id);
    if (n && !n.readAt) notificationRecords.update(id, { readAt: new Date().toISOString() });
  }

  readAll() {
    for (const n of this.all) if (!n.readAt) this.read(n.id);
  }

  /** Where a notification opens in the app: its link's path and anchor. */
  href(n: NotificationRecord) {
    try {
      const url = new URL(n.url);
      return url.pathname + url.hash;
    } catch {
      return `/w/${n.workspaceId}/p/${n.pageId}`;
    }
  }
}

export const inbox = new Inbox();
