<script lang="ts">
  import { type InboxGroup, type InboxItem, InboxList } from "@desk/core/inbox";
  import { FileText } from "lucide-svelte";
  import { goto } from "$app/navigation";
  import type { NotificationRecord } from "$model/sync";
  import { inbox } from "$lib/stores/inbox.svelte";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import { now } from "$lib/stores/now.svelte";
  import { local } from "$lib/sync/local.svelte";
  import { brief } from "$lib/time";
  import Avatar from "../properties/Avatar.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";

  /** The inbox: what the person was told, grouped by page; opening one marks it read and goes to it. */
  let { onclose }: { onclose: () => void } = $props();

  const LABEL: Record<NotificationRecord["type"], string> = {
    mention: "Mention",
    reply: "Reply",
    watch: "Watching",
    share: "Shared",
    invite: "Invite",
  };

  type Row = InboxItem & { readonly n: NotificationRecord };

  /** What a notification says beyond its title, on one line. */
  const said = (n: NotificationRecord) => (n.type === "watch" ? inbox.changes(n).map((c) => c.summary).join(" · ") : n.text) ?? "";

  const groups = $derived(
    inbox.groups.map((group): InboxGroup<Row> & { readonly pageId: string } => {
      const page = local.page(group.pageId);
      return {
        key: group.pageId,
        pageId: group.pageId,
        title: page ? page.title || "Untitled" : "A page",
        items: group.items.map((n) => ({
          id: n.id,
          n,
          title: n.title,
          text: said(n) || undefined,
          meta: `${LABEL[n.type]} · ${brief(n.updatedAt, now.value)}`,
          unread: !n.readAt,
        })),
      };
    }),
  );

  function open(row: Row) {
    inbox.read(row.n.id);
    onclose();
    void goto(inbox.href(row.n));
  }
</script>

<InboxList
  {groups}
  unread={inbox.unread}
  onopen={open}
  onreadall={() => inbox.readAll()}
  empty="Nothing yet. Mentions, replies, shares and changes to pages you watch show here."
>
  {#snippet heading(group)}
    {@const icon = local.page(group.key)?.icon}
    {#if icon}<IconGlyph {icon} size={14} />{:else}<FileText size={14} />{/if}
  {/snippet}
  {#snippet lead(row)}
    {@const actor = row.n.actor ? peopleApi.person(row.n.actor) : null}
    <Avatar name={actor?.name ?? "?"} src={actor?.avatar} />
  {/snippet}
</InboxList>
