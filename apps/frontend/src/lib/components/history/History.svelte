<script lang="ts">
  import { History, X } from "lucide-svelte";
  import { fly } from "svelte/transition";
  import { api, type Page, type Version } from "$lib/api";
  import { notices } from "$lib/stores/notices.svelte";
  import { now } from "$lib/stores/now.svelte";
  import { people } from "$lib/stores/people.svelte";
  import { synced } from "$lib/sync/client.svelte";
  import { brief, stamp } from "$lib/time";
  import { editors, names } from "./author";
  import Editors from "./Editors.svelte";
  import VersionDiff from "./VersionDiff.svelte";
  import VersionList from "./VersionList.svelte";

  /**
   * The page's edit trail. Its top bar says when the page was last edited and by whom; that opens the trail: who
   * changed what and when, and bringing a version back.
   */
  let { page, canEdit, button }: { page: Page; canEdit: boolean; button: string } = $props();

  /** Edits arrive in bursts while someone types: the trail is asked for once they pause. */
  const REFRESH_DELAY_MS = 1500;

  let open = $state(false);
  let versions = $state.raw<readonly Version[] | null>(null);
  let failed = $state(false);
  let selected = $state<string | null>(null);
  let restoring = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();

  const shown = $derived(versions?.find((v) => v.id === selected) ?? null);
  const authors = $derived(editors(versions ?? []));
  const editedAt = $derived(page.updatedAt ?? versions?.[0]?.editedAt);
  const summary = $derived(
    [authors.length ? `Edited by ${names(authors)}` : "Version history", editedAt && stamp(editedAt)].filter(Boolean).join(" · "),
  );

  // Answers for a page left behind are dropped: only the latest request may write.
  let request = 0;
  let loadedFor: string | undefined;

  async function load({ flush }: { flush: boolean }) {
    const ticket = ++request;
    try {
      // Edits not yet sent would be missing from the trail.
      if (flush) await synced.flush();
      const list = await api.pages(page.id).versions.$get();
      if (ticket !== request) return;
      versions = list;
      failed = false;
      if (!list.some((v) => v.id === selected)) selected = list[0]?.id ?? null;
    } catch (error) {
      if (ticket !== request) return;
      failed = true;
      if (open) notices.error(error);
    }
  }

  $effect(() => {
    const id = page.id;
    // Read to be tracked: each saved edit moves it, made here or by someone else and brought by the sync.
    void page.updatedAt;
    const fresh = loadedFor !== id;
    if (fresh) {
      loadedFor = id;
      versions = null;
      failed = false;
      selected = null;
    }
    const timer = setTimeout(() => void load({ flush: false }), fresh ? 0 : REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  /** After a failure the list starts over, loading, rather than keep showing what went wrong. */
  function retry() {
    versions = null;
    failed = false;
    void load({ flush: true });
  }

  function show() {
    open = true;
    if (page.workspaceId) void people.load(page.workspaceId);
    if (failed) retry();
    else void load({ flush: true });
    queueMicrotask(() => panel?.focus());
  }

  function close() {
    open = false;
    trigger?.focus();
  }

  async function restore(version: Version) {
    restoring = true;
    try {
      await synced.flush();
      await api.pages(page.id).versions(version.id).restore.$post();
      await synced.sync();
      notices.show(`Restored the version from ${stamp(version.editedAt)}`);
      selected = null;
      await load({ flush: false });
    } catch (error) {
      notices.error(error);
    } finally {
      restoring = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => open && e.key === "Escape" && close()} />

<button
  class="mr-1 flex h-7 items-center gap-2 rounded-sm px-1.5 whitespace-nowrap transition-colors hover:bg-ink-5 hover:text-ink"
  title={summary}
  aria-label="Version history"
  aria-haspopup="dialog"
  aria-expanded={open}
  bind:this={trigger}
  onclick={() => (open ? close() : show())}
>
  <History size={16} class="shrink-0" />
  {#if editedAt}<time class="-ml-0.5 max-sm:hidden" datetime={editedAt}>{brief(editedAt, now.value)}</time>{/if}
  {#if authors.length}<Editors {authors} />{/if}
</button>

{#if open}
  <div
    transition:fly={{ x: 40, duration: 160 }}
    class="fixed inset-y-2 right-2 z-40 flex w-[calc(100%-1rem)] max-w-4xl flex-col overflow-hidden rounded-lg bg-surface text-[14px] text-ink shadow-float outline-none"
    role="dialog"
    aria-label="Version history"
    tabindex="-1"
    bind:this={panel}
  >
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-3 pl-6">
      <h2 class="min-w-0 flex-1 truncate font-medium">Version history <span class="text-ink-45">· {page.title || "Untitled"}</span></h2>
      <button class={button} title="Close" aria-label="Close" onclick={close}><X size={16} /></button>
    </div>
    <div class="flex min-h-0 flex-1 max-md:flex-col-reverse">
      <section class="min-h-0 flex-1 overflow-y-auto" aria-label="Changes">
        {#if shown && versions}
          <VersionDiff pageId={page.id} version={shown} canRestore={canEdit && shown.id !== versions[0]?.id} {restoring} onrestore={() => void restore(shown)} />
        {/if}
      </section>
      <VersionList {versions} {failed} {selected} onselect={(id) => (selected = id)} onretry={retry} />
    </div>
  </div>
{/if}
