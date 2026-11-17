<script lang="ts">
  import { type DateValue, formatNumber, type PropertyDefinition, type PropertyValue as Value } from "$model/properties";
  import type { ViewRow } from "$lib/api";
  import PropertyValue from "../properties/PropertyValue.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import { pageEntries } from "$lib/page-menu";
  import { menu } from "$lib/stores/context-menu.svelte";
  import { people } from "$lib/stores/people.svelte";
  import { brief, formatDay } from "$lib/time";
  import { blank, cellOf } from "./cells";

  /**
   * A page as a card: its title, then one line that says who has it, how old it is (or when it is due), and its
   * numbers; the other shown properties that have a value below, read-only.
   */
  let { row, shown, onopen }: { row: ViewRow; shown: readonly PropertyDefinition[]; onopen: () => void } = $props();
  const cells = $derived(shown.map((column) => cellOf(row, column)));
  const owner = $derived(cells.find((c) => c.definition.type === "person"));
  const ownerId = $derived(Array.isArray(owner?.value) ? (owner.value as { id: string }[])[0]?.id : undefined);
  const due = $derived(cells.find((c) => c.definition.type === "date" && !blank(c.value)));
  const numbers = $derived(cells.filter((c) => c.definition.type === "number" && typeof c.value === "number"));
  const inLine = $derived(new Set([owner, due, ...numbers].map((c) => c?.definition.name)));
  const rest = $derived(cells.filter((c) => !inLine.has(c.definition.name) && !blank(c.value)));
  const when = $derived.by(() => {
    if (due) return `${due.definition.name.toLowerCase()} ${formatDay((due.value as DateValue).start, due.definition.dateFormat)}`;
    return row.updatedAt ? brief(row.updatedAt) : null;
  });
</script>

<button class="block w-full rounded-md bg-surface px-3 py-2 text-left shadow-panel transition-shadow hover:shadow-card" onclick={onopen} use:menu={() => pageEntries(row.id, { peek: onopen })}>
  <span class="line-clamp-3 block text-[14px] leading-snug font-medium">{row.title || "Untitled"}</span>
  <span class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-ink-45 tabular-nums">
    {#if owner}
      {#if ownerId}
        <span class="flex min-w-0 items-center gap-1 text-ink-70">
          <span class="scale-[0.8]"><Avatar name={people.name(ownerId) ?? "?"} src={people.avatar(ownerId)} /></span>
          <span class="truncate">{people.name(ownerId) ?? "Someone"}</span>
        </span>
      {:else}
        <span>unassigned</span>
      {/if}
    {/if}
    {#if when}{#if owner}<span class="text-ink-30">·</span>{/if}<span>{when}</span>{/if}
    {#each numbers as cell (cell.definition.name)}
      <span class="text-ink-30">·</span>
      <span title={cell.definition.name}>{formatNumber(cell.value as number, cell.definition.numberFormat)}</span>
    {/each}
  </span>
  {#each rest as cell (cell.definition.name)}
    <span class="pointer-events-none mt-1.5 block text-[13px]">
      <PropertyValue definition={cell.definition} value={cell.value as Value} editable={false} onchange={() => {}} />
    </span>
  {/each}
</button>
