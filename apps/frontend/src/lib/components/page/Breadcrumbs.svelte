<script lang="ts">
  import { viewIcon } from "$lib/view-icon";
  import { Shapes } from "lucide-svelte";
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";
  import { pageHref } from "$lib/actions";
  import type { PageData } from "$lib/api";
  import { local } from "$lib/sync/local.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import KindPill from "../ui/KindPill.svelte";
  import Popover from "../ui/Popover.svelte";

  type Crumb = PageData["ancestors"][number] | PageData["page"];

  let { ancestors, current }: { ancestors: PageData["ancestors"]; current: PageData["page"] } = $props();

  /** The pages at the end of the trail that stay in it, the parent and the page; the ones between them and the first fold into "…". */
  const TAIL = 2;

  const trail = $derived<readonly Crumb[]>(ancestors.at(-1)?.id === current.id ? ancestors : [...ancestors, current]);
  // The workspace, then "…" for everything between it and the parent.
  const folded = $derived(trail.length > TAIL + 1 ? trail.slice(1, -TAIL) : []);
  const shown = $derived(folded.length ? [trail[0], ...trail.slice(-TAIL)] : trail);

  const LEAVE_MS = 90;
  /** The page's own crumb stays in its place from page to page: going to a sibling only changes what it says. */
  const CURRENT = "current";

  /** A crumb that goes fades where it stood, out of the flow, so the others slide into place at once; a new one comes in after it, never over it. */
  function leave(node: HTMLElement) {
    const left = node.offsetLeft;
    return { duration: LEAVE_MS, css: (t: number) => `position: absolute; left: ${left}px; opacity: ${t};` };
  }
</script>

{#snippet label(page: Crumb)}
  {@const kind = local.page(page.id)?.kind}
  {#if page.icon}<IconGlyph icon={page.icon} size="1.15em" class="shrink-0" />{:else if kind === "trait"}<Shapes
      size="1.15em"
      class="shrink-0 text-ink-45"
    />{:else if kind === "view"}{@const ViewIcon = viewIcon(page.id)}<ViewIcon size="1.15em" class="shrink-0 text-ink-45" />{/if}<span class="truncate">{page.title || "Untitled"}</span><KindPill {kind} id={page.id} />
{/snippet}

<nav class="relative flex min-w-0 items-center gap-0.5 text-ink-70" aria-label="Breadcrumbs">
  {#each shown as ancestor, index (index === shown.length - 1 ? CURRENT : ancestor.id)}
    <span class="flex min-w-0 items-center gap-0.5" animate:flip={{ duration: 160 }} in:fade={{ duration: 140, delay: LEAVE_MS }} out:leave>
      {#if index > 0}<span class="text-ink-20">/</span>{/if}
      <a class="flex h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-sm px-1.5 transition-colors hover:bg-ink-5 hover:text-ink" href={pageHref(ancestor.id)}>
        {#key ancestor.id}<span class="flex min-w-0 items-center gap-1.5" in:fade={{ duration: 120 }}>{@render label(ancestor)}</span>{/key}
      </a>
      {#if index === 0 && folded.length}
        <span class="text-ink-20">/</span>
        <Popover width="w-60">
          {#snippet trigger({ toggle })}
            <button class="flex h-7 items-center rounded-sm px-1.5 transition-colors hover:bg-ink-5 hover:text-ink" aria-label="Show {folded.length} more pages" onclick={toggle}>…</button>
          {/snippet}
          {#snippet children({ close })}
            {#each folded as page (page.id)}
              <a class="menu-item" href={pageHref(page.id)} onclick={close}>{@render label(page)}</a>
            {/each}
          {/snippet}
        </Popover>
      {/if}
    </span>
  {/each}
</nav>
