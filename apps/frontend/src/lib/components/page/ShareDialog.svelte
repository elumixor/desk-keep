<script lang="ts">
  import { Share2 } from "lucide-svelte";
  import { SHARE_ROLES, type ShareRole } from "$model/access";
  import { api } from "$lib/api";
  import { access } from "$lib/stores/access.svelte";
  import { me } from "$lib/stores/me.svelte";
  import { notices } from "$lib/stores/notices.svelte";
  import { pageBar, type ShareSuggestion } from "$lib/stores/page-bar.svelte";
  import { people } from "$lib/stores/people.svelte";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import PersonOrEmailPicker, { type Invitee } from "../people/PersonOrEmailPicker.svelte";
  import Popover from "../ui/Popover.svelte";
  import SelectMenu from "../ui/SelectMenu.svelte";

  /** Who a page (and what is under it) is shared with, and sharing it: from the page's top bar, for whoever may. */
  let { pageId, workspaceId, button }: { pageId: string; workspaceId: string; button: string } = $props();

  type Shares = Awaited<ReturnType<ReturnType<typeof api.pages>["shares"]["$get"]>>;

  const ROLE_LABELS: Record<ShareRole, string> = {
    view: "Can view",
    comment: "Can comment",
    edit: "Can edit",
    full: "Full access",
  };
  const choices = SHARE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  let open = $state(false);
  let role = $state<ShareRole>("view");
  let list = $state<Shares | null>(null);
  let busy = $state(false);
  /** Who has a share here already, and whoever is sharing it, by People id: the picker leaves them out. */
  const shared = $derived(
    new Set([
      ...(list?.shares ?? []).flatMap((s) => (s.person.peopleId ? [s.person.peopleId] : [])),
      ...(me.current?.peopleId ? [me.current.peopleId] : []),
    ]),
  );

  async function load() {
    try {
      list = await api.pages(pageId).shares.$get();
    } catch (error) {
      notices.error(error);
    }
  }

  /** Somebody named on the page who cannot see it, offered first ("X can't see this page — Share"). */
  let suggested = $state.raw<ShareSuggestion | null>(null);

  $effect(() => {
    const id = pageId;
    pageBar.sharing = id;
    return () => {
      if (pageBar.sharing === id) pageBar.sharing = null;
    };
  });

  $effect(() => {
    const request = pageBar.share;
    if (!request) return;
    pageBar.share = null;
    // A request for another page (made before the open page changed) is stale: dropped, never kept for later.
    if (request.pageId !== pageId) return;
    suggested = request;
    role = request.role;
    open = true;
  });

  $effect(() => {
    if (!open) {
      suggested = null;
      return;
    }
    void load();
    if (access.member(workspaceId)) void people.load(workspaceId);
  });

  async function share(invitee: Invitee) {
    busy = true;
    try {
      const body = "person" in invitee ? { person: invitee.person, role } : { email: invitee.email, role };
      const made = await api.pages(pageId).shares.$post(body);
      notices.show(made.created ? `Shared with ${made.person.name}` : `${made.person.name} now has ${ROLE_LABELS[made.role].toLowerCase()}`);
      if (suggested && "person" in invitee && invitee.person === suggested.person.id) suggested = null;
      await load();
    } catch (error) {
      notices.error(error);
    } finally {
      busy = false;
    }
  }

  async function change(shareId: string, next: ShareRole) {
    try {
      await api.pages(pageId).shares(shareId).$patch({ role: next });
      await load();
    } catch (error) {
      notices.error(error);
    }
  }

  async function revoke(shareId: string) {
    try {
      await api.pages(pageId).shares(shareId).$delete();
      await load();
    } catch (error) {
      notices.error(error);
    }
  }
</script>

<Popover bind:open align="end" width="w-96">
  {#snippet trigger({ toggle })}
    <button class={button} class:bg-ink-5={open} class:text-ink={open} title="Share" aria-label="Share" aria-expanded={open} onclick={toggle}><Share2 size={16} /></button>
  {/snippet}
  {#snippet children()}
    <div class="space-y-2 p-1" data-testid="share-dialog">
      {#if suggested}
        {@const person = suggested.person}
        <button class="menu-item" disabled={busy} onclick={() => void share({ person: person.id, name: person.name })}>
          <Avatar name={person.name} src={peopleApi.person(person.id)?.avatar ?? null} />
          <span class="truncate">Share with {person.name}</span>
          <span class="ml-auto shrink-0 text-[12px] text-ink-45">{ROLE_LABELS[role]}</span>
        </button>
      {/if}
      <div class="flex items-start gap-1">
        <div class="min-w-0 flex-1"><PersonOrEmailPicker exclude={shared} onpick={(i) => void share(i)} /></div>
        <SelectMenu class="bg-ink-5 text-[13px]" label="Role" value={role} {choices} disabled={busy} onpick={(r) => (role = r)} />
      </div>
      <p class="px-1 text-[12px] text-ink-45">They get this page and everything under it. Full access may also share it and move it to the trash.</p>
      {#if list?.shares.length}
        <ul class="divide-y divide-line">
          {#each list.shares as share (share.id)}
            <li class="flex items-center gap-2 py-1.5">
              <Avatar name={share.person.name} src={share.person.avatar} />
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-1.5 truncate">
                  <span class="truncate">{share.person.name}</span>
                  {#if share.person.pending}<span class="rounded-xs bg-ink-5 px-1 text-[11px] text-ink-45">pending</span>{/if}
                </p>
                <p class="truncate text-[12px] text-ink-45">
                  {#if share.inherited}From {share.from?.title || "Untitled"}{:else}{share.person.email ?? ""}{/if}
                </p>
              </div>
              {#if share.inherited || !list.can.share}
                <span class="text-[12px] text-ink-45">{ROLE_LABELS[share.role]}</span>
              {:else}
                <SelectMenu class="text-[13px]" label="Role" value={share.role} {choices} onpick={(r) => void change(share.id, r)} />
                <button class="text-[13px] text-ink-30 hover:text-hot" onclick={() => void revoke(share.id)}>Revoke</button>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if list}
        <p class="px-1 text-[12px] text-ink-30">Only the workspace's members have this page.</p>
      {/if}
    </div>
  {/snippet}
</Popover>
