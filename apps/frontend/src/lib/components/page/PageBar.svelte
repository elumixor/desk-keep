<script lang="ts">
  import { pages } from "$lib/stores/pages.svelte";
  import { pageBar } from "$lib/stores/page-bar.svelte";
  import { width } from "$lib/stores/width.svelte";
  import SidebarToggle from "../sidebar/SidebarToggle.svelte";
  import Breadcrumbs from "./Breadcrumbs.svelte";
  import { access } from "$lib/stores/access.svelte";
  import PageMenu from "./PageMenu.svelte";
  import ShareDialog from "./ShareDialog.svelte";
  import TrashBanner from "./TrashBanner.svelte";

  /** The top bar over the open page. It stays in place from page to page; only what it holds changes. */
  let { id }: { id: string } = $props();

  const glow = "bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,color-mix(in_srgb,var(--hot)_30%,transparent),transparent)]";

  const ours = $derived(pageBar.id === id);
  const trashedAt = $derived(ours ? pageBar.trashedAt : null);
  const data = $derived(pages.get(id) ?? (ours && trashedAt ? pageBar.kept : undefined));
</script>

<!-- The page fades out under the top bar. -->
<div class="pointer-events-none sticky top-0 z-[15] shrink-0 before:absolute before:inset-x-0 before:top-0 before:-z-10 before:h-[95px] before:bg-linear-to-b before:from-page before:from-16% before:to-transparent">
  <header class="flex h-11 items-center gap-1 px-3 text-[14px] *:pointer-events-auto">
    <SidebarToggle />
    {#if data}
      {@const page = data.page}
      <Breadcrumbs ancestors={data.ancestors} current={page} />
      <div class="ml-auto flex items-center gap-0.5 text-ink-45">
        {#if page.kind === "page" && !trashedAt && access.can(page.id, "share")}
          <ShareDialog pageId={page.id} workspaceId={page.workspaceId ?? page.id} button="grid size-7 place-items-center rounded-sm transition-colors hover:bg-ink-5 hover:text-ink" />
        {/if}
        <PageMenu
          {page}
          canEdit={data.canEdit && !trashedAt}
          canDelete={access.can(page.id, "delete") && !trashedAt}
          wide={width.wide(page.id, page.kind === "view")}
          onwide={(next) => width.set(page.id, next)}
          onremove={() => pageBar.remove()}
        />
      </div>
    {/if}
  </header>
  {#if trashedAt && data}
    <!-- A page in the trash: a red layer over the whole bar, hiding what it holds and taking its clicks. -->
    <div class="absolute inset-x-0 top-0 h-[95px] bg-linear-to-b from-page from-45% to-transparent"></div>
    <div class="absolute inset-x-0 top-0 h-32 {glow}"></div>
    <div class="pointer-events-auto absolute inset-x-0 top-0 grid h-11 grid-cols-[1fr_auto_1fr] items-center px-3">
      <div><SidebarToggle /></div>
      <TrashBanner pageId={id} parentId={data.page.parentId} since={trashedAt} />
    </div>
  {/if}
</div>
