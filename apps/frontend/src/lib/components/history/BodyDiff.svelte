<script lang="ts">
  import type { DiffLine, Skipped } from "$model/history";
  import Words from "./Words.svelte";

  /** The body's lines as Markdown: changed ones marked, unchanged runs between them folded to a count. */
  let { lines }: { lines: readonly (DiffLine | Skipped)[] } = $props();

  const LINE = {
    added: { gutter: "+", tone: "bg-accent/10", label: "Added" },
    removed: { gutter: "−", tone: "bg-hot/10 text-ink-70", label: "Removed" },
    kept: { gutter: "", tone: "", label: "" },
  } as const;
</script>

<ol class="overflow-hidden rounded-md border border-line font-mono text-[13px] leading-6">
  {#each lines as line, i (i)}
    {#if "skipped" in line}
      <li class="border-y border-line bg-ink-5 px-3 text-[12px] text-ink-45 first:border-t-0 last:border-b-0">
        {line.skipped} unchanged {line.skipped === 1 ? "line" : "lines"}
      </li>
    {:else}
      {@const { gutter, tone, label } = LINE[line.change]}
      <li class="flex {tone}">
        <span class="w-7 shrink-0 select-none text-center text-ink-30" aria-hidden="true">{gutter}</span>
        {#if label}<span class="sr-only">{label}:</span>{/if}
        <span class="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">{#if line.words}<Words parts={line.words} />{:else}{line.text}{/if}</span>
      </li>
    {/if}
  {/each}
</ol>
