<script lang="ts">
  import { moveTo } from "$lib/portal";
  import { viewIcon } from "$lib/view-icon";
  import { tick, untrack } from "svelte";
  import { page as route } from "$app/state";
  import { Archive, ArchiveRestore, Shapes, SmilePlus, TextQuote } from "lucide-svelte";
  import { setArchived } from "$lib/page-menu";
  import { formatDay } from "$lib/time";
  import type { JSONContent } from "@tiptap/core";
  import { deletePage, pageHref } from "$lib/actions";
  import { PageMissingError, pages, type PageData } from "$lib/stores/pages.svelte";
  import { access } from "$lib/stores/access.svelte";
  import { pageBar } from "$lib/stores/page-bar.svelte";
  import { width } from "$lib/stores/width.svelte";
  import CommentsSection from "../comments/CommentsSection.svelte";
  import ViewBody from "../views/ViewBody.svelte";
  import ViewToolbar from "../views/ViewToolbar.svelte";
  import { local } from "$lib/sync/local.svelte";
  import Editor from "../editor/Editor.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import Item from "../ui/Item.svelte";
  import Skeleton from "../ui/Skeleton.svelte";
  import PageMenu from "./PageMenu.svelte";
  import PropertiesPanel from "./PropertiesPanel.svelte";
  import TrashBanner from "./TrashBanner.svelte";
  import TraitPanel from "./TraitPanel.svelte";
  import TraitViews from "../views/TraitViews.svelte";
  import TextField from "../ui/TextField.svelte";

  /** A node of the tree as its screen: a page, a trait (its properties and pages) or a view (what it shows). */
  let { id, embedded = false, menuIn, focusTitle = false }: {
    id: string;
    embedded?: boolean;
    /** Where its menu goes when something around it has a bar for it: a peek. */
    menuIn?: HTMLElement;
    /** Opens with the cursor in the title: a peek. */
    focusTitle?: boolean;
  } = $props();

  const glow = "bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,color-mix(in_srgb,var(--hot)_30%,transparent),transparent)]";

  const live = $derived(pages.get(id));
  /** A trait's own views, shown as tabs under it; a trait that has them switches between them, not with a partner. */
  const traitViews = $derived(local.pages.get(id)?.kind === "trait" ? local.childrenOf(id).filter((c) => c.kind === "view" && local.showsAlone(c.id, id)) : []);
  const partner = $derived(traitViews.length ? undefined : local.partnerOf(id));
  // A page moved to trash leaves the synced records; it stays on screen, as it was, until restored or left.
  let trashedAt = $state<string | null>(null);
  const trashed = $derived(trashedAt !== null);
  let kept = $state.raw<PageData>();
  const data = $derived(live ?? (trashed ? kept : undefined));
  $effect(() => {
    if (live) {
      kept = live;
      trashedAt = null;
    }
  });
  // The description line opens when asked for, and stays while it holds text.
  let describing = $state(false);
  let describeInput = $state<HTMLInputElement>();
  const describe = () => {
    describing = true;
    // After the click is done with, so nothing it set off takes the focus back.
    void tick().then(() => requestAnimationFrame(() => describeInput?.focus()));
  };
  let missing = $state<string | null>(null);
  let unreachable = $state<string | null>(null);
  // Retried by the sync itself: the page shows once it arrives.
  $effect(() => {
    if (data) unreachable = null;
  });

  // Runs again only for another page: the records it reads while loading must not retrigger it.
  $effect(() => {
    const target = id;
    untrack(() => {
      missing = null;
      unreachable = null;
      trashedAt = null;
      pages
        .load(target)
        .then((inTrash) => {
          if (!inTrash || target !== id) return;
          kept = inTrash.data;
          trashedAt = inTrash.since;
        })
        .catch((error) => {
          if (error instanceof PageMissingError) missing = "This page does not exist, or you do not have access to it.";
          else unreachable = "Keep could not be reached. It keeps trying; this page opens as soon as it answers.";
        });
    });
  });

  // The top bar sits outside the page, so it stays put from one page to the next: this page tells it what it needs.
  $effect(() => {
    if (embedded) return;
    pageBar.id = id;
    pageBar.kept = kept;
    pageBar.trashedAt = trashedAt;
    pageBar.remove = remove;
  });

  let editor = $state<ReturnType<typeof Editor>>();

  /** A link to a comment (`#comment-<id>`, what a notification opens): scrolled to and flashed once it is drawn. */
  const COMMENT_HASH = /^#comment-([0-9a-f-]{36})$/;
  const FIND_TRIES = 20;
  const FIND_EVERY_MS = 150;
  // Once per page and link, not again on every edit of the page.
  const shown = $derived(!!data);
  $effect(() => {
    const wanted = route.url.hash.match(COMMENT_HASH)?.[0].slice(1);
    if (embedded || !wanted || !shown) return;
    let tries = 0;
    const timer = setInterval(() => {
      const target = document.getElementById(wanted);
      if (!target && ++tries < FIND_TRIES) return;
      clearInterval(timer);
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.animate([{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }], { duration: 1600 });
    }, FIND_EVERY_MS);
    return () => clearInterval(timer);
  });

  // The page switches at once: the skeleton is painted first, and the page (whose first drawing can take a while) is
  // built on the frame after, coming in block by block.
  let painted = $state(false);
  $effect(() => {
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => (painted = true))));
    return () => cancelAnimationFrame(frame);
  });

  /** The skeleton fades out over the page coming in, out of its way, from as far as its own delayed fade-in got. */
  function vanish(node: HTMLElement) {
    const from = Number(getComputedStyle(node).opacity);
    return { duration: 150, css: (t: number) => `animation: none; opacity: ${t * from}; position: absolute; inset-inline: 0; top: 0;` };
  }

  function setTitle(title: string) {
    pages.type(id, { title });
  }

  function setBody(body: JSONContent) {
    pages.type(id, { body: body as never });
  }

  function remove() {
    kept = live;
    deletePage(id);
    trashedAt = new Date().toISOString();
  }
</script>

{#if !painted || (!data && !missing && !unreachable)}
  {@render skeleton()}
{:else if missing}
  <div class="mx-auto w-full max-w-3xl px-6 py-24 text-center text-ink-45">{missing}</div>
{:else if !data}
  <div class="mx-auto w-full max-w-3xl px-6 py-24 text-center text-ink-45">{unreachable}</div>
{:else}
  {@const page = data.page}
  {@const wide = width.wide(page.id, page.kind === "view")}
  {@const query = page.kind === "view" ? local.view(page.id) : undefined}
  <!-- A timeline's page is as tall as the room it has, the timeline taking what its title and toolbar leave. -->
  {@const fill = (query?.kind === "timeline" || query?.kind === "table")}
  {@const column = fill ? "flex min-h-0 flex-1 flex-col" : ""}
  {#if embedded && trashedAt}
    <div class="py-2 {glow}"><TrashBanner pageId={id} parentId={page.parentId} since={trashedAt} /></div>
  {/if}
  <!-- Text keeps to the page's width (narrow unless widened); a view in it always takes all the room there is. -->
  <!-- The page's full width, without its padding: what a view's body (`.view-full`) spans. -->
  <div class="@container {fill ? column : 'shrink-0'}">
  <article class="mx-auto w-full px-6 md:px-24 {fill ? column : 'pb-24'} {embedded ? 'pt-2' : 'pt-2'}" data-narrow={wide ? undefined : ""}>
    {#if embedded}
      <div class="-mt-2 mb-2 flex justify-end" use:moveTo={menuIn}>
        <PageMenu {page} canEdit={data.canEdit && !trashed} canDelete={access.can(page.id, "delete") && !trashed} {wide} onwide={(next) => width.set(page.id, next)} onremove={remove} />
      </div>
    {/if}

    {#if page.archivedAt && !trashed}
      <!-- Archived: out of the sidebar and views, here as it was; restoring puts it back. -->
      <div class="mb-3 flex items-center gap-2 rounded-md bg-ink-5 px-3 py-1.5 font-ui text-[13px] text-ink-70" data-testid="archived-banner">
        <Archive size={14} class="shrink-0 text-ink-45" />
        <span class="min-w-0 flex-1 truncate">Archived {formatDay(page.archivedAt)}: out of the sidebar and views, still found by search.</span>
        {#if data.canEdit}
          <button class="item item-normal item-hug shrink-0" onclick={() => setArchived(page.id, false)}><ArchiveRestore size={14} /> Restore</button>
        {/if}
      </div>
    {/if}

    <!-- The title is the editor's first line; the icon, properties, comments and views are drawn around it, a line under them. -->
    <Editor
      bind:this={editor}
      pageId={page.id}
      title={page.title}
      content={page.body as JSONContent | null}
      editable={data.canEdit && !trashed}
      ontitle={setTitle}
      onicon={(icon) => pages.edit(id, { icon })}
      onchange={setBody}
      brief={page.kind !== "page"}
      {focusTitle}
    >
      {#snippet head()}
        <div class="group/props">
          <!-- "Add icon" shows here on hover when the page has none; the icon itself sits left of the title. Either opens the picker (Editor). -->
          {#if data.canEdit && !trashed && (!page.icon || (!page.description && !describing))}
            <div contenteditable="false" class="-mb-2.5 flex items-center gap-x-1 font-ui {page.icon ? 'mt-1' : ''}">
              {#if !page.icon}
                <Item size="small" edge data-page-icon class="opacity-0 transition-[opacity,background-color,color] group-hover/props:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
                  ><SmilePlus size={14} />Add icon</Item
                >
              {/if}
              {#if !page.description && !describing}
                <Item size="small" edge={!!page.icon} class="opacity-0 transition-[opacity,background-color,color] group-hover/props:opacity-100 focus-visible:opacity-100 max-md:opacity-100" onmousedown={(e) => e.preventDefault()} onclick={describe}
                  ><TextQuote size={14} />Add description</Item
                >
              {/if}
            </div>
          {/if}
          <!-- A trait or view always shows what it is: a pill after its title (app.css). -->
          <div class="group/title relative flex items-center gap-3 {page.icon && !page.description && !describing ? 'mb-4' : ''}" data-kind={page.kind === "page" || partner ? undefined : page.kind}>
            {#if page.icon}
            <button type="button" contenteditable="false" data-page-icon class="block shrink-0 rounded-sm leading-none transition-colors enabled:hover:bg-ink-5" aria-label="Change icon" disabled={!data.canEdit || trashed}
              ><IconGlyph icon={page.icon} size={40} animate /></button
            >
            {/if}
            <div data-title-slot class="min-w-0 {partner ? 'shrink' : 'flex-1'}"></div>
            {#if partner}
              <!-- A view and its trait are one thing seen two ways: a switch between them, this one chosen. -->
              {@const pair = page.kind === "view" ? [{ id: page.id, kind: "view" }, partner] : [partner, { id: page.id, kind: "trait" }]}
              <div contenteditable="false" class="mr-auto flex shrink-0 items-center gap-0.5 rounded-full bg-ink-5 p-0.5 font-ui text-ink-45">
                {#each pair as side (side.id)}
                  {@const here = side.id === page.id}
                  <a
                    href={pageHref(side.id)}
                    class="grid h-7 w-9 place-items-center rounded-full transition-colors {here ? 'bg-accent-soft text-accent' : 'hover:bg-ink-10 hover:text-ink'}"
                    aria-current={here ? "page" : undefined}
                    title={here ? `This ${side.kind}` : `Open its ${side.kind}`}
                  >{#if side.kind === "trait"}<Shapes size={16} />{:else}{@const ViewIcon = viewIcon(side.id)}<ViewIcon size={16} />{/if}</a>
                {/each}
              </div>
            {/if}
          </div>
          {#if page.description || describing}
            <div contenteditable="false" class="-mt-3 flex items-center gap-1 font-ui {page.icon ? 'mb-8' : 'mb-4'}">
              <TextQuote size={14} class="shrink-0 text-ink-30" />
              <TextField
                bind:ref={describeInput}
                class="flex-1 px-1.5 bg-transparent text-ink-45 hover:bg-ink-5 focus:bg-ink-10 read-only:bg-transparent"
                placeholder="Description"
                maxlength={1000}
                value={page.description}
                readonly={!data.canEdit || trashed}
                oninput={(e) => pages.type(id, { description: e.currentTarget.value })}
                onfocus={() => (describing = true)}
                onkeydown={(e) => (e.key === "Enter" || e.key === "Escape") && (e.preventDefault(), e.currentTarget.blur())}
                onblur={() => {
                  describing = false;
                  // Left empty, it goes: "Add description" shows again.
                  if (page.description && !page.description.trim()) pages.type(id, { description: "" });
                }}
              />
            </div>
          {/if}
          <!-- Under the title, small links: a view's or trait's partner, a page's traits. The panel below pulls itself up: they keep clear of it. -->
          {#if (page.kind === "view" && query) || (page.kind === "page" && page.traits.length)}
            <div contenteditable="false" class="item-edge flex flex-wrap items-center gap-x-1 font-ui {page.kind === 'view' ? '-mt-3 mb-0' : '-mt-4 mb-5'}" data-testid="traits">
              {#if page.kind === "view" && query}
                <!-- A view's settings sit right under its title. -->
                <ViewToolbar view={query} canEdit={data.canEdit && !trashed} />
              {/if}
              {#if page.kind === "page"}
                {#each page.traits as trait (trait.id)}
                  <Item size="small" href={pageHref(trait.id)} data-trait={trait.name}
                    >{#if trait.icon}<IconGlyph icon={trait.icon} size={14} />{:else}<Shapes size={14} />{/if}{trait.name}</Item
                  >
                {/each}
              {/if}
            </div>
          {/if}
          {#if page.kind !== "view"}<div contenteditable="false">
            {#if page.kind === "trait"}
              <TraitPanel {data} editable={data.canEdit && !trashed} compact={traitViews.length > 0} />
            {:else if page.kind === "page"}
              <PropertiesPanel {data} editable={data.canEdit && !trashed} />
              <CommentsSection pageId={page.id} open={!trashed} />
            {/if}
            {#if page.kind === "page"}<div class="mt-4 border-t border-line" role="separator"></div>{/if}
          </div>{/if}
        </div>
      {/snippet}
    </Editor>
    {#if page.kind === "trait" && traitViews.length}
      <section class="mt-2 w-full animate-appear font-ui [animation-delay:60ms]" data-testid="trait-view-tabs">
        <TraitViews traitId={page.id} views={traitViews} canEdit={data.canEdit && !trashed} />
      </section>
    {/if}
    {#if query}
      <section class="-mt-6 w-full animate-appear font-ui [animation-delay:60ms] {column}" data-testid="view-page">
        <div class="view-full pt-2 {column}"><ViewBody view={query} canEdit={data.canEdit && !trashed} {fill} /></div>
      </section>
    {/if}
  </article>
  </div>
{/if}

{#snippet skeleton()}
  <div class="mx-auto w-full max-w-[calc(var(--page-width)+12rem)] animate-skeleton space-y-4 px-6 md:px-24 {embedded ? 'pt-24' : 'pt-7'}" out:vanish>
    <Skeleton class="h-10 w-2/3" /><Skeleton class="h-4 w-full" /><Skeleton class="h-4 w-5/6" /><Skeleton class="h-4 w-1/2" />
  </div>
{/snippet}
