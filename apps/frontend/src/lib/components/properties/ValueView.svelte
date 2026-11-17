<script lang="ts">
  import { ArrowRight } from "lucide-svelte";
  import { formatDay } from "$lib/time";
  import { type DateValue, formatNumber, type PropertyDefinition, type PropertyValue } from "$model/properties";
  import OneLine from "../ui/OneLine.svelte";
  import PagePill from "./PagePill.svelte";

  /**
   * A value shown, not edited, as wide as it is: text, a link, a number, a date, yes or no, pages. What a formula's
   * result is drawn with, and a property that cannot be edited here.
   */
  let { definition, value }: { definition: Pick<PropertyDefinition, "type" | "dateFormat" | "numberFormat">; value: PropertyValue | undefined } = $props();

  const date = $derived(value && typeof value === "object" && "start" in value ? (value as DateValue) : null);
  const ids = $derived(Array.isArray(value) ? (value as string[]) : []);
  const shortDay = (iso: string) => formatDay(iso, definition.dateFormat);
</script>

{#if value === null || value === undefined || value === ""}
  <!-- Empty: nothing drawn. -->
{:else if definition.type === "url"}
  <a class="truncate px-1.5 underline decoration-ink-30 underline-offset-[3px] hover:decoration-ink" href={String(value)} target="_blank" rel="noreferrer">{value}</a>
{:else if definition.type === "number"}
  <span class="truncate px-1.5 text-ink-70 tabular-nums">{typeof value === "number" ? formatNumber(value, definition.numberFormat) : value}</span>
{:else if definition.type === "date" && date}
  <span class="flex items-center gap-1 truncate px-1.5 text-ink-70">
    {shortDay(date.start)}{#if date.end}<ArrowRight size={12} class="text-ink-30" />{shortDay(date.end)}{/if}
  </span>
{:else if definition.type === "checkbox"}
  <input type="checkbox" class="mx-1.5 size-4 accent-[var(--accent)]" disabled checked={value === true} />
{:else if definition.type === "relation"}
  <OneLine items={ids} key={(id) => id} squeeze={96} class="min-w-0 px-0.5">
    {#snippet item(id)}<PagePill {id} />{/snippet}
  </OneLine>
{:else}
  <span class="truncate px-1.5">{String(value)}</span>
{/if}
