<script lang="ts">
  import { pageHref } from "$lib/actions";
  import { local } from "$lib/sync/local.svelte";
  import PageMention from "../editor/PageMention.svelte";
  import Popover from "../ui/Popover.svelte";

  interface Linked {
    readonly id: string;
    readonly title: string;
    readonly icon: string | null;
  }

  /** Pages as links, one a line, the first few: the rest behind "N more", which lists them all in a popup. */
  let { linked, class: extra = "" }: { linked: readonly Linked[]; class?: string } = $props();

  /** Where a page lives: its workspace, then its parent, with "…" for what lies between. */
  function path(id: string) {
    const page = local.pages.get(id);
    if (!page) return "";
    const titles = local.ancestors(page).map((p) => p.title || "Untitled");
    return (titles.length > 2 ? [titles[0], "…", titles.at(-1)] : titles).join(" / ");
  }

  const SHOWN = 5;

  /** "N more" lists every page, one a row, drawn a batch at a time as the list scrolls. */
  const BATCH = 50;
  let listOpen = $state(false);
  let limit = $state(BATCH);
  $effect(() => {
    if (!listOpen) limit = BATCH;
  });

  function loadMore(sentinel: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) limit += BATCH;
    });
    observer.observe(sentinel);
    return { destroy: () => observer.disconnect() };
  }
</script>

<div class="flex min-w-0 flex-1 flex-col items-start gap-0.5 {extra}">
  {#each linked.slice(0, SHOWN) as page (page.id)}
    <a class="flex min-w-0 max-w-full no-underline" href={pageHref(page.id)} title={path(page.id)}
      ><span class="mention has-icon item-inline flex min-w-0 items-center"><PageMention id={page.id} label={page.title} saved={page.icon} fit /></span></a
    >
  {/each}
  {#if linked.length > SHOWN}
    <Popover bind:open={listOpen} width="w-96">
      {#snippet trigger({ toggle })}
        <button class="shrink-0 whitespace-nowrap text-[12px] text-ink-30 hover:text-ink-70" aria-expanded={listOpen} onclick={toggle}>{linked.length - SHOWN} more</button>
      {/snippet}
      {#snippet children({ close })}
        {#each linked.slice(0, limit) as page (page.id)}
          <a class="menu-item text-ink" href={pageHref(page.id)} onclick={close}>
            <span class="mention has-icon min-w-0 flex-1 truncate"><PageMention id={page.id} label={page.title} saved={page.icon} /></span>
            <span class="max-w-40 shrink-0 truncate text-[12px] text-ink-30">{path(page.id)}</span>
          </a>
        {/each}
        {#if limit < linked.length}<div class="h-px" use:loadMore></div>{/if}
      {/snippet}
    </Popover>
  {/if}
</div>
