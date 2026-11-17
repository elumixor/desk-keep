<script lang="ts">
  import { CircleAlert, Info, SquareMousePointer } from "lucide-svelte";
  import { fly } from "svelte/transition";
  import { pageHref } from "$lib/actions";
  import { notices } from "$lib/stores/notices.svelte";
  import { local } from "$lib/sync/local.svelte";
  import PageGlyph from "./PageGlyph.svelte";

  /** Short messages in the corner, each with its icon, and what it came from (a button on a page) small under it. */
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-2" aria-live="polite">
  {#each notices.list as notice (notice.id)}
    {@const Icon = notice.icon ?? (notice.tone === "error" ? CircleAlert : Info)}
    {@const page = notice.source?.pageId ? local.page(notice.source.pageId) : undefined}
    <div
      transition:fly={{ y: 8, duration: 150 }}
      class="pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg bg-surface py-2.5 pr-4 pl-3 shadow-float"
    >
      <span class="grid h-6 shrink-0 place-items-center {notice.tone === 'error' ? 'text-hot' : 'text-ink-45'}"><Icon size={16} /></span>
      <div class="min-w-0 flex-1 py-0.5">
        <button class="block w-full text-left text-[14px] {notice.tone === 'error' ? 'text-hot' : 'text-ink'}" onclick={() => notices.dismiss(notice.id)}>{notice.text}</button>
        {#if notice.source}
          <p class="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-ink-45">
            <SquareMousePointer size={12} class="shrink-0" />
            <span class="truncate">{notice.source.label}</span>
            {#if notice.source.pageId}
              <span class="shrink-0">on</span>
              <a class="inline-flex min-w-0 items-center gap-1 rounded-xs underline decoration-ink-20 underline-offset-2 hover:text-ink" href={pageHref(notice.source.pageId)}
                ><PageGlyph icon={page?.icon} kind={page?.kind} id={page?.id} size={12} /><span class="truncate">{page?.title || "Untitled"}</span></a
              >
            {/if}
          </p>
        {/if}
      </div>
      {#if notice.action}
        {@const { label, run } = notice.action}
        <button class="rounded-sm px-2 py-0.5 font-medium text-accent hover:bg-ink-5" onclick={() => { notices.dismiss(notice.id); run(); }}>{label}</button>
      {/if}
    </div>
  {/each}
</div>
