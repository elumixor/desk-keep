<script lang="ts" generics="T">
  import { type Snippet, untrack } from "svelte";
  import { fitting, sizes } from "$lib/one-line";

  /**
   * Items on one line: as many as fit, then "N more". Where the line may open (`expandable`), the marker is a button
   * that lets it wrap to show them all; inside another control it is only a count, and that control shows the rest.
   */
  let {
    items,
    key,
    item,
    expandable = false,
    gap = "gap-1",
    class: extra = "",
    more,
    squeeze,
  }: {
    items: readonly T[];
    key: (item: T) => string;
    item: Snippet<[T]>;
    expandable?: boolean;
    /** Between items, for the line and the hidden copy it is measured by alike. */
    gap?: string;
    class?: string;
    /** Draws the marker instead, given how many are left: a control of its own that shows the rest. */
    more?: Snippet<[number]>;
    /**
     * Items may be cut down to this many pixels each (or their own width, when less), so more of them fit: each then
     * shrinks with its room, the longest the most. Their content must clip itself.
     */
    squeeze?: number;
  } = $props();

  /** Past this many, the line is full whatever their widths: the rest are not rendered until it opens. */
  const MEASURED = 40;
  const MARKER = "shrink-0 whitespace-nowrap text-[12px] text-ink-30";
  let row = $state<HTMLElement>();
  let marker = $state<HTMLElement>();
  let fit = $state(MEASURED);
  /** What each item may shrink to while squeezed. */
  let floors = $state<number[]>([]);
  let open = $state(false);
  const rendered = $derived(open ? items : items.slice(0, MEASURED));
  const left = $derived(items.length - (open ? items.length : Math.min(fit, items.length)));

  $effect(() => {
    if (!row || !marker) return;
    const [line, more] = [row, marker];
    const total = items.length;
    const measure = () => {
      const children = [...line.querySelectorAll<HTMLElement>(":scope > [data-item]")];
      // Squeezed items are measured at their full width, held from shrinking for the read.
      if (squeeze) for (const child of children) child.style.flexShrink = "0";
      const widths = children.map((child) => child.getBoundingClientRect().width);
      if (squeeze) for (const child of children) child.style.flexShrink = "";
      const spacing = Number.parseFloat(getComputedStyle(line).columnGap) || 0;
      // Kept apart from `floors`: the effect reading the state it writes would run itself again.
      const least = squeeze ? widths.map((width) => Math.min(width, squeeze)) : [];
      const same = untrack(() => least.length === floors.length && least.every((width, index) => width === floors[index]));
      if (!same) floors = least;
      fit = fitting(squeeze ? least : widths, total, line.clientWidth, spacing, more.getBoundingClientRect().width);
    };
    measure();
    const stop = sizes.watch(line, measure);
    return stop;
  });
</script>

<!-- Items past the fit stay in place but out of the flow and sight, so each is rendered once and measured where it is. -->
<div class="relative flex min-w-0 items-center {gap} {open ? 'flex-wrap' : ''} {extra}" bind:this={row}>
  {#each rendered as entry, index (key(entry))}
    <span
      class="flex max-w-full {squeeze && !open ? 'min-w-0 shrink' : 'shrink-0'} {open || index < fit ? '' : 'pointer-events-none invisible absolute top-0 left-0'}"
      style:min-width={squeeze && !open && floors[index] ? `${floors[index]}px` : undefined}
      data-item>{@render item(entry)}</span>
  {/each}
  {#if more && left}
    {@render more(left)}
  {:else if expandable && (open || left)}
    <button class="{MARKER} hover:text-ink-70" aria-expanded={open} onclick={() => (open = !open)}>{open ? "Fewer" : `${left} more`}</button>
  {:else if left}
    <span class={MARKER}>{left} more</span>
  {/if}
  <span class="{MARKER} pointer-events-none invisible absolute" aria-hidden="true" bind:this={marker}>{items.length} more</span>
</div>
