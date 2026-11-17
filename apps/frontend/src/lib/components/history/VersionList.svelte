<script lang="ts">
  import type { Version } from "$lib/api";
  import { clock, day, sameMinute } from "$lib/time";
  import Skeleton from "../ui/Skeleton.svelte";
  import AuthorAvatar from "./AuthorAvatar.svelte";
  import { authorName } from "./author";
  import Changes from "./Changes.svelte";

  /** The page's versions down a timeline, newest first, under the day each was made. */
  let {
    versions,
    failed,
    selected,
    onselect,
    onretry,
  }: {
    versions: readonly Version[] | null;
    failed: boolean;
    selected: string | null;
    onselect: (id: string) => void;
    onretry: () => void;
  } = $props();

  const SKELETON_ROWS = 4;
  const STEPS: Readonly<Record<string, number>> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 };

  const days = $derived(
    (versions ?? []).reduce<{ day: string; versions: Version[] }[]>((groups, version) => {
      const label = day(version.createdAt);
      const last = groups.at(-1);
      return last?.day === label
        ? [...groups.slice(0, -1), { ...last, versions: [...last.versions, version] }]
        : [...groups, { day: label, versions: [version] }];
    }, []),
  );

  let list = $state<HTMLElement>();

  function onkeydown(event: KeyboardEvent) {
    const step = STEPS[event.key];
    if (!step || !versions?.length) return;
    event.preventDefault();
    const at = versions.findIndex((v) => v.id === selected);
    const next = versions[Math.min(Math.max(at + step, 0), versions.length - 1)];
    onselect(next.id);
    list?.querySelector<HTMLElement>(`[data-version="${next.id}"]`)?.focus();
  }

  const time = (version: Version) =>
    sameMinute(version.createdAt, version.editedAt) ? clock(version.createdAt) : `${clock(version.createdAt)}–${clock(version.editedAt)}`;
</script>

<nav class="min-h-0 shrink-0 overflow-y-auto border-line p-2 max-md:max-h-[40%] max-md:border-b md:w-72 md:border-l" aria-label="Versions" bind:this={list}>
  {#if !versions && failed}
    <div class="space-y-2 p-3 text-[13px] text-ink-45" role="alert">
      <p>The history could not be loaded. Check the connection, then try again.</p>
      <button class="rounded-sm px-2 py-1 font-medium text-ink transition-colors hover:bg-ink-5" onclick={onretry}>Try again</button>
    </div>
  {:else if !versions}
    <div class="space-y-4 p-2" aria-busy="true">
      {#each { length: SKELETON_ROWS }, i (i)}
        <div class="flex gap-2.5"><Skeleton class="size-5 rounded-full" /><div class="flex-1 space-y-1.5"><Skeleton class="h-4 w-2/3" /><Skeleton class="h-3 w-1/3" /></div></div>
      {/each}
    </div>
  {:else if !versions.length}
    <p class="p-3 text-[13px] text-ink-45">No edits recorded yet. Each change made from now on shows here.</p>
  {:else}
    {#each days as group (group.day)}
      <h3 class="sticky top-0 z-10 bg-surface px-2 pt-2 pb-1 text-[12px] font-medium text-ink-45">{group.day}</h3>
      <ol>
        {#each group.versions as version (version.id)}
          <!-- The timeline: a rule through the avatars, which a ring of the panel's colour cuts around. -->
          <li class="relative before:absolute before:top-0 before:bottom-0 before:left-[17.5px] before:w-px before:bg-line first:before:top-4 last:before:bottom-auto last:before:h-4 only:before:hidden">
            <button
              data-version={version.id}
              class="relative flex w-full gap-2.5 rounded-md px-2 py-2 text-left text-[14px] transition-colors hover:bg-ink-5 {version.id === selected ? 'bg-ink-5' : ''}"
              aria-current={version.id === selected}
              onclick={() => onselect(version.id)}
              {onkeydown}
            >
              <span class="mt-px rounded-full ring-2 ring-surface"><AuthorAvatar author={version.author} /></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2">
                  <span class="truncate font-medium text-ink">{authorName(version.author)}</span>
                  <time class="ml-auto shrink-0 font-mono text-[11px] text-ink-45 tabular-nums" datetime={version.createdAt}>{time(version)}</time>
                </span>
                <Changes {version} />
              </span>
            </button>
          </li>
        {/each}
      </ol>
    {/each}
  {/if}
</nav>
