<script lang="ts">
  import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-svelte";
  import type { DateValue } from "$model/properties";
  import { cubicOut } from "svelte/easing";
  import { untrack } from "svelte";
  import { Spring } from "svelte/motion";
  import { lean, SNAP_SPRING } from "$lib/snap";
  import { fade, fly, scale } from "svelte/transition";

  /** A month calendar picking one day, or a range once "End date" is on: the first click sets the start, the next the end. */
  let { value, onpick }: { value: DateValue | null; onpick: (next: DateValue | null) => void } = $props();

  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);
  const today = iso(new Date());

  const start = $derived(value?.start.slice(0, 10));
  const end = $derived(value?.end?.slice(0, 10));
  let range = $state(false);
  let picking = $state<"start" | "end">("start");
  let month = $state(new Date());
  $effect.pre(() => {
    range = !!value?.end;
  });
  $effect.pre(() => {
    const base = value ? parse(value.start) : new Date();
    month = new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const title = $derived(month.toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
  /** Six weeks from the Monday on or before the 1st. */
  const days = $derived.by(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i));
  });
  let direction = $state(1);
  const go = (next: Date) => {
    direction = next >= month ? 1 : -1;
    month = next;
  };
  const shift = (by: number) => go(new Date(month.getFullYear(), month.getMonth() + by, 1));

  function pick(day: string) {
    if (!range) return onpick({ start: day });
    // A click on an end of the range only selects that end for the next pick.
    if (end && (day === start || day === end)) return void (picking = day === end ? "end" : "start");
    if (picking === "start" || !start || day < start) {
      picking = "end";
      return onpick({ start: day, ...(end && end >= day && { end }) });
    }
    picking = "start";
    onpick({ start, end: day });
  }

  /** Which end of the range is being dragged; a drag that moved swallows the click that ends it. */
  let dragging = $state<"start" | "end" | null>(null);
  let moved = false;

  function grab(event: PointerEvent, day: string) {
    if (!start || (day !== start && day !== end)) return;
    dragging = range && day === end ? "end" : "start";
    moved = false;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  /** The filled squares marking the start and end, sliding between days and following the pointer while dragged. */
  let cells = $state<HTMLDivElement>();
  const CELL = 28;
  const knobs = { start: new Spring({ x: 0, y: 0 }, SNAP_SPRING), end: new Spring({ x: 0, y: 0 }, SNAP_SPRING) };
  const shown = $state({ start: false, end: false });
  let pointer = $state<{ x: number; y: number } | null>(null);

  /** Where a day's square sits in the grid shown now (the newest when a month is sliding in). */
  function spot(day: string | undefined) {
    if (!day || !cells) return null;
    const el = [...cells.querySelectorAll<HTMLElement>(`[data-day="${day}"]`)].at(-1);
    if (!el) return null;
    let x = 0, y = 0;
    for (let node: HTMLElement | null = el; node && node !== cells; node = node.offsetParent as HTMLElement | null) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    return { x, y };
  }

  $effect(() => {
    const days = { start, end: range ? end : undefined };
    void month.getTime();
    for (const which of ["start", "end"] as const) {
      const home = spot(days[which]);
      const held = dragging === which && pointer && home;
      // A held end leans from its day toward the pointer, so it feels pulled to the nearest day.
      const target = held ? { x: lean(home.x, pointer!.x - CELL / 2), y: lean(home.y, pointer!.y - CELL / 2) } : home;
      if (!target) {
        shown[which] = false;
        continue;
      }
      knobs[which].set(target, { instant: !untrack(() => shown[which]) });
      shown[which] = true;
    }
  });

  /** The range's shading, one bar per week it spans, its ends at the centres of the start and end squares. */
  const bands = $derived.by(() => {
    if (!range || !start || !end || start === end || !cells) return [];
    const width = cells.clientWidth;
    const out: { y: number; left: number; right: number }[] = [];
    for (let row = 0; row < 6; row++) {
      const week = days.slice(row * 7, row * 7 + 7).map(iso);
      if (week[6] < start || week[0] > end) continue;
      const y = spot(week[0])?.y;
      if (y === undefined) continue;
      const left = week.includes(start) ? knobs.start.current.x + CELL / 2 : 0;
      const right = week.includes(end) ? knobs.end.current.x + CELL / 2 : width;
      if (right > left) out.push({ y, left, right });
    }
    return out;
  });

  function drag(event: PointerEvent) {
    if (!dragging || !start) return;
    if (cells) {
      const box = cells.getBoundingClientRect();
      pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    }
    const day = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-day]")?.dataset.day;
    if (!day) return;
    if (!range || !end) {
      if (day === start) return;
      moved = true;
      return onpick({ start: day });
    }
    const other = dragging === "start" ? end : start;
    if (day === (dragging === "start" ? start : end)) return;
    moved = true;
    // Dropped onto the other end, the range collapses to that single day.
    if (day === other) {
      dragging = "start";
      range = false;
      picking = "start";
      return onpick({ start: day });
    }
    // Crossing the other end swaps which end is held.
    if ((dragging === "start" && day > other) || (dragging === "end" && day < other)) dragging = dragging === "start" ? "end" : "start";
    onpick(day < other ? { start: day, end: other } : { start: other, end: day });
  }

  function drop() {
    if (!dragging) return;
    dragging = null;
    pointer = null;
    if (moved) setTimeout(() => (moved = false));
  }

  let startField = $state<HTMLButtonElement>();
  $effect(() => startField?.focus({ preventScroll: true }));

  function addEnd() {
    range = true;
    picking = "end";
  }

  /** Delete or Backspace on a field empties it: the end drops back to a single day, the start clears the date. */
  function erase(event: KeyboardEvent, which: "start" | "end") {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    if (which === "end") {
      range = false;
      picking = "start";
      if (value) onpick({ start: value.start });
    } else if (range && end) {
      picking = "start";
      onpick({ start: end });
      range = false;
    } else onpick(null);
  }

  const label = (s: string | undefined) => (s ? parse(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
</script>

<svelte:window onpointermove={drag} onpointerup={drop} onpointercancel={drop} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onkeydown={(e) => erase(e, range && picking === "end" ? "end" : "start")} class="flex flex-col gap-2 p-2 text-[13px] {dragging ? 'cursor-grabbing select-none' : ''}">
  <div class="flex items-center gap-1">
    <button class="min-w-0 flex-1 rounded-sm border px-2 py-1 text-left outline-none transition-colors {picking === 'start' || !range ? 'border-accent' : 'border-ink-10'} {start ? '' : 'text-ink-30'}"
      onclick={() => (picking = "start")} bind:this={startField}>{start ? label(start) : "Start date"}</button>
    <ArrowRight size={14} class="shrink-0 text-ink-30" />
    {#if range}
      <button in:fly={{ x: -8, duration: 160, easing: cubicOut }} class="min-w-0 flex-1 rounded-sm border px-2 py-1 text-left outline-none transition-colors {picking === 'end' ? 'border-accent' : 'border-ink-10'} {end ? '' : 'text-ink-30'}"
        onclick={() => (picking = "end")}>{end ? label(end) : "End date"}</button>
    {:else}
      <button class="min-w-0 flex-1 rounded-sm border border-dashed border-ink-10 px-2 py-1 text-left text-ink-30 outline-none transition-colors hover:border-ink-30 hover:text-ink-45"
        onclick={addEnd}>End date</button>
    {/if}
  </div>

  <div class="flex items-center justify-between">
    <span class="grid overflow-hidden pl-1 font-medium">{#key title}<span class="col-start-1 row-start-1" in:fly={{ y: 8 * direction, duration: 180, easing: cubicOut }} out:fade={{ duration: 100 }}>{title}</span>{/key}</span>
    <span class="flex items-center">
      <button class="rounded-sm px-1.5 py-0.5 text-ink-45 hover:bg-ink-5 hover:text-ink" onclick={() => go(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
      <button class="grid size-6 place-items-center rounded-sm text-ink-45 hover:bg-ink-5 hover:text-ink" aria-label="Previous month" onclick={() => shift(-1)}><ChevronLeft size={16} /></button>
      <button class="grid size-6 place-items-center rounded-sm text-ink-45 hover:bg-ink-5 hover:text-ink" aria-label="Next month" onclick={() => shift(1)}><ChevronRight size={16} /></button>
    </span>
  </div>

  <div class="grid grid-cols-7 text-center">
    {#each weekdays as w, i (i)}<span class="py-1 text-[11px] text-ink-30">{w}</span>{/each}
  </div>
  <div class="relative grid [clip-path:inset(-6px)]" bind:this={cells}>
  {#each bands as band, i (i)}
    <span class="pointer-events-none absolute top-0 left-0 h-7 bg-accent-soft" transition:fade={{ duration: 120 }}
      style="translate: {band.left}px {band.y}px; width: {band.right - band.left}px"></span>
  {/each}
  {#key month.getTime()}
  <div class="relative col-start-1 row-start-1 grid grid-cols-7 text-center" in:fly={{ x: 24 * direction, duration: 220, easing: cubicOut }} out:fly={{ x: -24 * direction, duration: 160, easing: cubicOut }}>
    {#each days as d (d.getTime())}
      {@const day = iso(d)}
      {@const edge = day === start || day === end}
      <span class="py-px">
        <button
          class="mx-auto grid size-7 place-items-center rounded-sm transition-[background-color,color,transform] duration-150 active:scale-90
            {edge ? '' : 'hover:bg-ink-5'}
            {edge ? (dragging ? 'cursor-grabbing touch-none' : 'cursor-grab touch-none') : ''}
            {d.getMonth() !== month.getMonth() && !edge ? 'text-ink-30' : ''}
            {day === today && !edge ? 'font-semibold text-accent' : ''}"
          data-day={day} onpointerdown={(e) => grab(e, day)} onclick={() => !moved && pick(day)}>{d.getDate()}</button>
      </span>
    {/each}
  </div>
  {/key}
    {#each ["start", "end"] as const as which (which)}
      {@const day = which === "start" ? start : range ? end : undefined}
      {#if day && shown[which]}
        <span
          class="pointer-events-none absolute left-0 top-0 grid size-7 place-items-center rounded-sm bg-accent text-white transition-[box-shadow,scale] duration-150
            {dragging === which ? 'z-20 scale-110 shadow-lg' : 'z-10'}
            {range && end && picking === which ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''}"
          style="translate: {knobs[which].current.x}px {knobs[which].current.y}px"
          transition:scale={{ start: 0.6, duration: 140 }}>{parse(day).getDate()}</span>
      {/if}
    {/each}
  </div>

</div>
