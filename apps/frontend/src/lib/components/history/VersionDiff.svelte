<script lang="ts">
  import { RotateCcw } from "lucide-svelte";
  import { api, type Version, type VersionDetail } from "$lib/api";
  import { notices } from "$lib/stores/notices.svelte";
  import { ago, stamp } from "$lib/time";
  import Skeleton from "../ui/Skeleton.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import AuthorAvatar from "./AuthorAvatar.svelte";
  import { authorName } from "./author";
  import BodyDiff from "./BodyDiff.svelte";
  import type { PropertyChange } from "$model/history";
  import PropertyDiff from "./PropertyDiff.svelte";
  import Words from "./Words.svelte";

  /** One version: who made it, when, and what it changed from the one before. */
  let {
    pageId,
    version,
    canRestore,
    restoring,
    onrestore,
  }: { pageId: string; version: Version; canRestore: boolean; restoring: boolean; onrestore: () => void } = $props();

  let detail = $state.raw<VersionDetail | null>(null);
  // The list reloads after a restore with new objects for the same versions: only another version loads again.
  const id = $derived(version.id);
  $effect(() => {
    const target = id;
    let current = true;
    detail = null;
    api
      .pages(pageId)
      .versions(target)
      .$get()
      .then((found) => {
        if (current) detail = found;
      })
      .catch((error: unknown) => notices.error(error));
    return () => {
      current = false;
    };
  });

  const bodyChanged = $derived(detail?.diff.body.some((line) => !("skipped" in line)) ?? false);
</script>

<header class="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-6 py-3">
  <AuthorAvatar author={version.author} />
  <div class="min-w-0 flex-1">
    <p class="truncate font-medium text-ink">{authorName(version.author)}</p>
    <p class="text-[12px] text-ink-45"><time datetime={version.editedAt}>{stamp(version.editedAt)}</time> · {ago(version.editedAt)}</p>
  </div>
  {#if canRestore}
    <button
      class="flex h-7 items-center gap-1.5 rounded-sm border border-line px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-ink-5 disabled:opacity-50"
      disabled={restoring}
      onclick={onrestore}><RotateCcw size={14} /> {restoring ? "Restoring…" : "Restore this version"}</button
    >
  {/if}
</header>

{#if !detail}
  <div class="space-y-3 px-6 py-6" aria-busy="true">
    <Skeleton class="h-7 w-2/3" />
    <Skeleton class="h-4 w-1/3" />
    <Skeleton class="mt-6 h-24 w-full" />
  </div>
{:else}
  {@const { diff } = detail}
  <div class="space-y-6 px-6 py-6">
    <h3 class="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">
      {#if diff.icon?.before}<del class="mr-1 rounded-sm bg-hot/20 decoration-hot/60"><IconGlyph icon={diff.icon.before} size="1em" class="align-[-0.1em]" /></del>{/if}
      {#if detail.version.icon}<span class="mr-1 rounded-sm {diff.icon ? 'bg-accent/20' : ''}"><IconGlyph icon={detail.version.icon} size="1em" class="align-[-0.1em]" /></span>{/if}
      {#if detail.version.title || detail.previous?.title}<Words parts={diff.title} />{:else}<span class="text-ink-30">Untitled</span>{/if}
    </h3>
    {#if diff.properties.length}
      <PropertyDiff changes={diff.properties as readonly PropertyChange[]} />
    {/if}
    {#if bodyChanged}
      <BodyDiff lines={diff.body} />
    {/if}
  </div>
{/if}
