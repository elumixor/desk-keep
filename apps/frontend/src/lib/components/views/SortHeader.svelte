<script lang="ts">
  import { ArrowDown, ArrowUp, type Type } from "lucide-svelte";

  /** A column that is no property (the name, when it was edited): its label, ordering the view by it on a click. */
  let { label, icon: Icon, sorted, onsort }: {
    label: string;
    icon: typeof Type;
    sorted: "asc" | "desc" | null;
    onsort?: (direction: "asc" | "desc" | null) => void;
  } = $props();
  const next = $derived(sorted === null ? "asc" : sorted === "asc" ? "desc" : null);
</script>

<button class="flex h-8 w-full items-center gap-1.5 pr-2 pl-1.5 text-left transition-colors select-none enabled:hover:bg-ink-5 enabled:hover:text-ink" disabled={!onsort}
  title={onsort ? `Sort ${next === "asc" ? "ascending" : next === "desc" ? "descending" : "off"}` : undefined} onclick={() => onsort?.(next)}>
  <Icon size={16} /><span class="truncate">{label}</span>
  {#if sorted === "asc"}<ArrowUp size={13} class="shrink-0 text-accent" />{:else if sorted === "desc"}<ArrowDown size={13} class="shrink-0 text-accent" />{/if}
</button>
