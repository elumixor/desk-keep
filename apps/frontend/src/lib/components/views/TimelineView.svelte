<script lang="ts">
  import { TITLE } from "$model/views";
  import { Sortable } from "$lib/sortable.svelte";
  import { tick, untrack } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { Spring, Tween } from "svelte/motion";
  import { lean, SNAP_SPRING } from "$lib/snap";
  import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText, Plus, Type } from "lucide-svelte";
  import type { DateValue, PropertyValue as Value } from "$model/properties";
  import type { View, ViewResult, ViewRow } from "$lib/api";
  import { pageEntries } from "$lib/page-menu";
  import { menu } from "$lib/stores/context-menu.svelte";
  import { pages } from "$lib/stores/pages.svelte";
  import { notices } from "$lib/stores/notices.svelte";
  import { pageRecords } from "$lib/sync/client.svelte";
  import { addTimelineDate, updateView } from "$lib/views";
  import PropertyIcon from "../properties/PropertyIcon.svelte";
  import PropertyHeader from "./PropertyHeader.svelte";
  import PropertyValue from "../properties/PropertyValue.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import SelectMenu from "../ui/SelectMenu.svelte";
  import { moveProperty } from "$lib/schema";
  import { blank, cellOf, columnTarget, moveColumn, shownColumns, withTitle } from "./cells";
  import { columnWidths } from "./widths.svelte";
  import { batches } from "./batches.svelte";
  import { followRows } from "./follow-rows";
  import RowIcon from "./RowIcon.svelte";
  import { RowDrag } from "./row-drag.svelte";
  import { flip } from "svelte/animate";
  import { type Place, placeEntries, subtasks } from "./subtasks.svelte";

  /**
   * Pages on a calendar of days by a date property: a sidebar of their titles and shown properties beside the bars,
   * one row each; a row whose bar is out of sight gets an arrow to it. Rows are drawn a batch at a time as they come
   * into sight.
   */
  let {
    view,
    result,
    canEdit,
    onopen,
    onadd,
    onplace,
    fill = false,
  }: {
    view: View;
    result: ViewResult;
    canEdit: boolean;
    onopen: (id: string) => void;
    onadd: (properties?: Record<string, unknown>) => void;
    onplace: Place;
    /** Fills its parent's height (a flex column) instead of keeping to the screen's. */
    fill?: boolean;
  } = $props();

  type Span = { start: number; end: number };
  const DAY_MS = 86_400_000;
  /** How wide a day is, by the period in sight, and how far around today the calendar reaches. */
  const PERIODS = { month: { px: 40, before: 60, after: 120 }, quarter: { px: 12, before: 180, after: 365 }, year: { px: 3, before: 365, after: 730 } } as const;
  type Period = keyof typeof PERIODS;
  const periodKey = $derived(`keep.timeline.period.${view.id}`);
  let period = $state<Period>("month");
  $effect(() => {
    try {
      const saved = localStorage.getItem(periodKey);
      period = saved && saved in PERIODS ? (saved as Period) : "month";
    } catch {
      period = "month";
    }
  });
  const DAY_PX = $derived(PERIODS[period].px);
  function setPeriod(next: Period) {
    period = next;
    try {
      localStorage.setItem(periodKey, next);
    } catch (error) {
      console.warn("[timeline] could not remember the period", error);
    }
    void tick().then(() => scrollTo(today - Math.round(viewWidth / 3 / DAY_PX), "instant"));
  }
  const NAME = TITLE;
  const widths = columnWidths(() => `keep.widths.${view.id}`, 140);
  /** Columns dragged by their handle into a new order, in the trait that has them. */
  const sorting = new Sortable("x", (name, before) => moveColumn(view, result, columns.map((c) => c.name), name, before));
  const HEAD_PX = 72;
  const ROW_PX = 32;
  const dateProperty = $derived(result.columns.find((p) => p.name === view.groupBy && p.type === "date") ?? result.columns.find((p) => p.type === "date"));
  const ADD_DATE = "$add";
  const dateChoices = $derived([
    ...result.columns.filter((p) => p.type === "date").map((p) => ({ value: p.name, label: p.name })),
    ...(canEdit ? [{ value: ADD_DATE, label: "Add date property" }] : []),
  ]);
  const pickDate = (value: string) => void (value === ADD_DATE ? addTimelineDate(view) : updateView(view, { groupBy: value }));
  const columns = $derived(shownColumns(view, result));
  /** What each bar shows past its title: the view's choice, every property but the dates when it has made none. */
  const barColumns = $derived(result.columns.filter((c) => c.name !== dateProperty?.name && (!view.barProperties || view.barProperties.includes(c.name))));

  const day = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10)) / DAY_MS);
  const iso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
  const span = (row: ViewRow): Span | null => {
    const value = dateProperty ? (cellOf(row, dateProperty).value as DateValue | undefined) : undefined;
    if (!value?.start) return null;
    const start = day(value.start);
    return { start, end: value.end ? Math.max(start, day(value.end)) : start };
  };

  /** The rows with their subtasks under them, as far as they are open. */
  const tree = $derived(subtasks.nest(view.id, result.rows));
  const batch = batches(() => tree.rows.length);
  const rows = $derived(tree.rows.slice(0, batch.limit).map((r) => ({ ...r, span: span(r.row) })));
  const today = Math.floor(Date.now() / DAY_MS);
  const spans = $derived(rows.flatMap((r) => (r.span ? [r.span] : [])));
  const first = $derived(Math.min(today - PERIODS[period].before, ...spans.map((s) => s.start)) - 7);
  const last = $derived(Math.max(today + PERIODS[period].after, ...spans.map((s) => s.end)) + 7);
  const days = $derived(Array.from({ length: last - first + 1 }, (_, i) => first + i));
  const weekend = (d: number) => [0, 6].includes(new Date(d * DAY_MS).getUTCDay());

  let collapsed = $state(readCollapsed());
  function readCollapsed() {
    try {
      return localStorage.getItem("keep.timeline.collapsed") === "1";
    } catch {
      return false;
    }
  }
  function toggleSidebar() {
    collapsed = !collapsed;
    try {
      localStorage.setItem("keep.timeline.collapsed", collapsed ? "1" : "0");
    } catch (error) {
      console.warn("[timeline] could not remember the sidebar", error);
    }
  }

  /** The column line pointed at or being dragged: lit the whole way, over the header too. */
  let lineHover = $state<string | null>(null);
  let resizing = $state<string | null>(null);
  const lineActive = $derived(resizing ?? lineHover);
  function startResize(event: PointerEvent, name: string, initial?: number) {
    resizing = name;
    addEventListener("pointerup", () => (resizing = null), { once: true });
    widths.resize(event, name, initial);
  }

  /** How far in the page's title sits (nothing outside a page), measured from the stylesheet's `--view-gutter`. */
  let gutter = $state(0);
  /** What the first column keeps left of its icon. */
  const FIRST_INSET = 18;
  /** The room left of the sidebar's first column, so its icons line up with the title. */
  const sidePad = $derived(Math.max(0, gutter - FIRST_INSET));

  /** The sidebar's columns, each with its width and where its right edge falls. */
  const sideColumns = $derived.by(() => {
    let x = sidePad;
    return withTitle(view, columns.map((c) => c.name)).map((name) => {
      const definition = columns.find((col) => col.name === name);
      return { name, label: definition?.name ?? "Name", initial: definition ? undefined : 240, definition };
    }).map((c) => {
      const width = Math.round(widths.of(c.name, c.initial));
      x += width;
      return { ...c, width, edge: x };
    });
  });
  /** How far the sidebar is out, eased as it is shown or hidden; its width follows, so the calendar slides with it. */
  const shown = new Tween(untrack(() => (collapsed ? 0 : 1)), { duration: 220, easing: cubicOut });
  $effect(() => {
    void shown.set(collapsed ? 0 : 1);
  });
  const sideWidth = $derived(Math.round((sideColumns.at(-1)?.edge ?? 0) * shown.current));
  const sideOut = $derived(sideWidth > 0);

  let scroller = $state<HTMLDivElement>();
  let scrollLeft = $state(0);
  let viewWidth = $state(0);
  let viewHeight = $state(0);
  /** The rows' height, stretched to the box's so the calendar runs to its bottom however few pages there are. */
  const bodyHeight = $derived(Math.max((rows.length + (canEdit ? 1 : 0)) * ROW_PX, viewHeight - HEAD_PX));
  /** The months the days span, each with how many of them it has. */
  const months = $derived.by(() => {
    const out: { start: number; days: number; label: string }[] = [];
    for (const d of days) {
      const date = new Date(d * DAY_MS);
      if (out.length && date.getUTCDate() !== 1) out[out.length - 1].days++;
      else out.push({ start: d, days: 1, label: date.toLocaleDateString(undefined, { month: period === "year" ? "short" : "long", year: "numeric", timeZone: "UTC" }) });
    }
    return out;
  });

  const scrollTo = (d: number, behavior: ScrollBehavior = "smooth") => scroller?.scrollTo({ left: (d - first - 2) * DAY_PX, behavior });
  let placed = false;
  $effect(() => {
    if (!scroller || placed) return;
    placed = true;
    scrollTo(today - 3, "instant");
  });

  /**
   * A bar being dragged: by its body (moving its dates, and up or down among the rows) or by an edge (its start or
   * end). Once the pointer has moved it is a drag, not a click, even if it comes back to where it started.
   */
  let drag = $state<{ id: string; mode: "move" | "start" | "end"; x: number; y: number; days: number; rows: number; moved: boolean; span: Span; index: number } | null>(null);
  const DRAG_PX = 3;

  function begin(event: PointerEvent, id: string, s: Span, mode: "move" | "start" | "end") {
    if (!canEdit || event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { id, mode, x: event.clientX, y: event.clientY, days: 0, rows: 0, moved: false, span: s, index: rows.findIndex((r) => r.row.id === id) };
  }

  function move(event: PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const moved = drag.moved || Math.abs(dx) > DRAG_PX || Math.abs(dy) > DRAG_PX;
    const shift = drag.mode === "move" ? Math.max(-drag.index, Math.min(rows.length - 1 - drag.index, Math.round(dy / ROW_PX))) : 0;
    drag = { ...drag, moved, days: Math.round(dx / DAY_PX), rows: shift };
    if (!moved) return;
    // As the date picker's days do: the bar springs to the days and row it would drop on, leaning toward the pointer.
    const at = dragged(drag);
    const place = placeOf(at);
    const pointed = {
      x: drag.mode === "end" ? place.x : (drag.span.start - first) * DAY_PX + dx,
      w: drag.mode === "move" ? place.w : drag.mode === "start" ? (drag.span.end - first + 1) * DAY_PX - ((drag.span.start - first) * DAY_PX + dx) : (drag.span.end - drag.span.start + 1) * DAY_PX + dx,
    };
    const target = { x: lean(place.x, pointed.x), w: Math.max(DAY_PX / 2, lean(place.w, pointed.w)), y: lean(shift * ROW_PX, drag.mode === "move" ? dy : 0) };
    settling++;
    void bar.set(target, { instant: held !== drag.id });
    held = drag.id;
  }

  const placeOf = (at: Span) => ({ x: (at.start - first) * DAY_PX, w: (at.end - at.start + 1) * DAY_PX });
  /** The bar held or settling after a drop, drawn where `bar` has it instead of where its dates put it. */
  let held = $state<string | null>(null);
  const bar = new Spring({ x: 0, w: 0, y: 0 }, SNAP_SPRING);
  let settling = 0;
  /** The held bar springs to `target`, then is drawn by its dates again. */
  function settle(id: string, target: { x: number; w: number; y: number }) {
    const token = ++settling;
    void bar.set(target).then(() => {
      if (token === settling && held === id && !drag) held = null;
    });
  }
  /** How far the dropped row's sidebar is from its new place, sliding there as the other rows do. */
  /** Rows dragged by their title to another place among their siblings, or under another row. */
  const rowDrag = new RowDrag(() => view.id);
  const sideShift = new Tween(0, { duration: 200, easing: cubicOut });

  /**
   * Rows slide to their new places when the order changes. The dropped one is already where it was let go: its bar
   * keeps its place on screen and springs home, its sidebar slides.
   */
  function rowFlip(node: HTMLElement, rects: { from: DOMRect; to: DOMRect }) {
    if (node.dataset.row !== held) return flip(node, rects, { duration: 200, easing: cubicOut });
    const dy = rects.from.top - rects.to.top;
    void bar.set({ ...bar.current, y: bar.current.y + dy }, { instant: true });
    settle(held, { ...bar.target, y: 0 });
    void sideShift.set(dy, { duration: 0 }).then(() => sideShift.set(0));
    return { duration: 0 };
  }

  /** Where a dragged bar's dates are, as it is being dragged. */
  function dragged(d: NonNullable<typeof drag>): Span {
    const { start, end } = d.span;
    if (d.mode === "start") return { start: Math.min(start + d.days, end), end };
    if (d.mode === "end") return { start, end: Math.max(end + d.days, start) };
    return { start: start + d.days, end: end + d.days };
  }

  function end() {
    if (!drag || !dateProperty) return;
    const d = drag;
    drag = null;
    if (!d.moved) return onopen(d.id);
    const next = dragged(d);
    // The bar settles from where it was let go; when the page takes another row, `rowFlip` carries it over.
    settle(d.id, { ...placeOf(next), y: 0 });
    if (next.start !== d.span.start || next.end !== d.span.end)
      pages.setProperty(d.id, dateProperty.name, { start: iso(next.start), ...(next.end !== next.start && { end: iso(next.end) }) });
    if (d.rows) reorder(d.id, d.index, d.index + d.rows);
  }

  /**
   * A page dragged to another row takes its place in the pages' own order, between its new neighbours: what the view
   * falls back on when its sorting has no say (ties), and all of it when there is none.
   */
  function reorder(id: string, from: number, to: number) {
    const others = rows.map((r) => r.row).filter((r) => r.id !== id);
    const before = others[to - 1];
    const after = others[to];
    const sort = before && after ? (before.sort + after.sort) / 2 : before ? before.sort + 1 : after ? after.sort - 1 : 0;
    pageRecords.update(id, { sort });
    if (view.sortCode?.trim() || view.sort.length)
      notices.show("The view is sorted: a dragged page moves only among those that sort the same.", {
        action: { label: "Stop sorting", run: () => updateView(view, { sortCode: null, sort: [] }) },
      });
    void from;
  }

  /** A page added next to or under a row starts on that row's first day, else today, so it has a bar from the start. */
  function place(id: string, where: "after" | "inside", s: Span | null) {
    if (dateProperty) onplace(id, where, { [dateProperty.name]: { start: iso(s?.start ?? today) } });
  }

  const addToday = () => dateProperty && onadd({ [dateProperty.name]: { start: iso(today) } });

    /** The day pointed at in an unscheduled row, where a click would put it. */
  /** `from`: the day pressed on, while the pointer is held to draw the dates out from it. */
  let pointing = $state<{ id: string; day: number; from: number | null } | null>(null);
  /**
   * Where the preview is drawn: springing to the days it would get, leaning toward the pointer, as a dragged bar does.
   */
  const ghost = new Spring({ x: 0, w: 0 }, SNAP_SPRING);
  function point(id: string, row: HTMLElement, clientX: number) {
    const x = clientX - row.getBoundingClientRect().left;
    const day = first + Math.floor(x / DAY_PX);
    const from = pointing?.id === id ? pointing.from : null;
    const span = from === null ? { start: day, end: day } : { start: Math.min(from, day), end: Math.max(from, day) };
    const place = placeOf(span);
    // The end the pointer holds leans toward it; the other stays on its day.
    const pulled = from === null ? { x: lean(place.x, x - DAY_PX / 2), w: place.w } : day >= from
      ? { x: place.x, w: lean(place.w, x - place.x) }
      : { x: lean(place.x, x), w: place.x + place.w - lean(place.x, x) };
    void ghost.set(pulled, { instant: pointing?.id !== id });
    pointing = { id, day, from };
  }
  /**
   * Pressing on an unscheduled row starts its dates there; letting go anywhere (on the same day: a click) sets them.
   * The pointer is followed on the window, so nothing it passes over can take the release from the row.
   */
  function press(id: string, event: PointerEvent & { currentTarget: HTMLElement }) {
    if (event.button !== 0) return;
    event.preventDefault();
    const row = event.currentTarget;
    point(id, row, event.clientX);
    if (pointing) pointing = { ...pointing, from: pointing.day };
    const move = (e: PointerEvent) => point(id, row, e.clientX);
    const up = (e: PointerEvent) => {
      stop();
      point(id, row, e.clientX);
      release(id);
    };
    const cancel = () => {
      stop();
      pointing = null;
    };
    const stop = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
  }
  function release(id: string) {
    if (pointing?.id !== id || pointing.from === null || !dateProperty) return;
    const [start, end] = [Math.min(pointing.from, pointing.day), Math.max(pointing.from, pointing.day)];
    pointing = null;
    pages.setProperty(id, dateProperty.name, { start: iso(start), ...(end !== start && { end: iso(end) }) });
  }
  const shortDate = (d: number) => new Date(d * DAY_MS).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

    /** Where a bar is against what is in sight: before it, after it, or in it. */
  const side = (s: Span) => {
    const left = (s.start - first) * DAY_PX;
    const right = (s.end - first + 1) * DAY_PX;
    return right <= scrollLeft ? "before" : left >= scrollLeft + viewWidth - sideWidth ? "after" : "in";
  };
</script>

{#if !dateProperty}
  <div class="flex flex-col items-center gap-2 py-10 text-ink-45">
    <p>A timeline places pages by a date property.</p>
    {#if canEdit}<button class="item item-normal item-hug text-ink" onclick={() => void addTimelineDate(view)}><Plus size={16} /> Add date property</button>{/if}
  </div>
{:else}
  <!-- One box scrolls both ways: the header sticks to its top, the sidebar to its left. -->
  <div
    class="-mt-2 overflow-auto text-[14px] {fill ? 'min-h-60 flex-1' : 'max-h-[calc(100dvh-5rem)] border-b border-line'}"
    data-testid="timeline-view"
    data-scroll-root
    style="--side: var(--page); --side-hover: color-mix(in srgb, var(--page), var(--text) 3%)"
    bind:this={scroller}
    bind:clientWidth={viewWidth}
    bind:clientHeight={viewHeight}
    onscroll={() => (scrollLeft = scroller?.scrollLeft ?? 0)}
  >
    <div class="relative" style="width: {sideWidth + days.length * DAY_PX}px; min-height: {viewHeight}px">
      <div class="pointer-events-none absolute h-0" style="width: var(--view-gutter, 0px)" bind:clientWidth={gutter}></div>
      <div class="pointer-events-none absolute bottom-0 flex" style="left: {sideWidth}px; top: {HEAD_PX}px">
        {#each days as d (d)}
          <div class="relative h-full shrink-0 {period === 'month' && weekend(d) ? 'bg-ink-5' : ''} {period !== 'month' && new Date(d * DAY_MS).getUTCDate() === 1 ? 'border-l border-line' : ''}" style="width: {DAY_PX}px">
            {#if d === today}<span class="absolute inset-y-0 left-1/2 w-px bg-hot"></span>{/if}
          </div>
        {/each}
      </div>

      {#if sidePad && sideOut}
        <!-- Left of the title stays empty: the rows' and header's lines start where the table does. -->
        <div class="pointer-events-none sticky left-0 z-[35] h-0 w-0">
          <span class="absolute top-0 left-0 bg-(--side)" style="width: {Math.min(sidePad, sideWidth)}px; height: {HEAD_PX + bodyHeight}px"></span>
        </div>
      {/if}

      {#if shown.current === 1 && !sorting.dragging}
        <!-- The sidebar's column lines run its whole height; dragging one anywhere resizes its column. -->
        <div class="pointer-events-none sticky left-0 z-[25] h-0 w-0">
          <!-- One shadow down the whole sidebar: a shadow per row would band where they overlap. -->
          <span class="absolute top-0 w-2.5 bg-linear-to-r from-(--edge-shadow) to-transparent" style="left: {sideWidth}px; height: {HEAD_PX + bodyHeight}px"></span>
          {#each sideColumns as c (c.name)}
            <span
              class="group pointer-events-auto absolute -ml-[3px] w-[7px] cursor-col-resize"
              style="left: {c.edge}px; top: {HEAD_PX}px; height: {bodyHeight}px"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize column"
              onpointerenter={() => (lineHover = c.name)}
              onpointerleave={() => (lineHover = null)}
              onpointerdown={(e) => startResize(e, c.name, c.initial)}
            ><span class="absolute inset-y-0 w-px {c === sideColumns.at(-1) ? 'left-[2px] bg-line' : 'left-[3px]'} {c === sideColumns.at(-1) ? '' : 'bg-line/30'}"></span
              ><!-- Lit as the header's part is, at the same pace, so the two read as one line. -->
              <span class="absolute inset-y-0 {c === sideColumns.at(-1) ? 'left-0' : 'left-[2px]'} w-[3px] bg-accent/50 transition-opacity duration-150 {lineActive === c.name ? 'opacity-100' : 'opacity-0'}"></span></span>
          {/each}
        </div>
      {/if}

      <div class="sticky top-0 z-30 flex border-b border-line bg-page" style="height: {HEAD_PX}px">
        {#if sideOut}
          <div class="sticky left-0 z-20 flex shrink-0 items-end overflow-x-clip bg-(--side) text-[13px] text-ink-45" style="width: {sideWidth}px">
            <div class="shrink-0" style="width: {sidePad}px"></div>
            {#each sideColumns as c (c.name)}
              {@const target = c.name === NAME ? null : columnTarget(result, c.name)}
              <div
                class="group/col relative flex h-full shrink-0 items-end select-none {c.name === NAME ? `pr-2 pb-2 ${c === sideColumns[0] ? 'pl-5' : 'pl-2'}` : `pr-0.5 pb-0.5 ${c === sideColumns[0] ? 'pl-3.5' : 'pl-0.5'}`} {sorting.dragging === c.name ? 'bg-(--side) shadow-card' : ''}"
                style="width: {c.width}px; {sorting.style(c.name)}"
                role="columnheader"
                tabindex="-1"
                onpointerdown={(e) => canEdit && (target || c.name === NAME) && sorting.start(e, c.name, sideColumns.map((col) => col.name), sideColumns.map((col) => col.width), 4)}
              >
                <!-- Its column's line, drawn over the header while it is pointed at or dragged. -->
                <span class="absolute inset-y-0 -right-1 z-10 w-[7px] cursor-col-resize" role="separator" aria-orientation="vertical" aria-label="Resize column"
                  onpointerenter={() => (lineHover = c.name)} onpointerleave={() => (lineHover = null)}
                  onpointerdown={(e) => { e.stopPropagation(); startResize(e, c.name, c.initial); }}
                  ><span class="absolute top-0 -bottom-px {c === sideColumns.at(-1) ? 'left-0' : 'left-[2px]'} w-[3px] transition-opacity duration-150 {lineActive === c.name ? 'opacity-100' : 'opacity-0'} bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--accent)_50%,transparent)_40px)]"></span></span>
                {#if c.definition}
                  <!-- A click opens the property's editor (on the trait, so every page having it follows); a drag moves it. -->
                  <div class="min-w-0 flex-1"><PropertyHeader {target} definition={c.definition} editable={canEdit && !!target}
                    onhide={() => void updateView(view, { visibleProperties: columns.map((col) => col.name).filter((n) => n !== c.name) })} /></div>
                {:else}
                  <span class="flex min-w-0 flex-1 items-center gap-1.5"><Type size={16} class="shrink-0" /><span class="truncate">{c.label}</span></span>
                {/if}
                {#if c === sideColumns.at(-1)}
                  <!-- After the last column's name, never squeezed by it. -->
                  <button class="mb-0.5 grid size-7 shrink-0 place-items-center rounded-sm text-ink-45 hover:bg-ink-5 hover:text-ink" aria-label="Hide the sidebar" onpointerdown={(e) => e.stopPropagation()} onclick={toggleSidebar}><ChevronsLeft size={16} /></button>
                {/if}
              </div>
            {/each}
            <!-- Where the table meets the calendar, fading out toward the top as the column lines do. -->
            <span class="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(to_bottom,transparent,var(--line)_60px)]"></span>
          </div>
        {/if}
        <div class="shrink-0" style="width: {days.length * DAY_PX}px">
          <!-- The controls hold to the edges in sight; each month's name sticks to the left until the next one takes its place. -->
          <div class="sticky z-10 h-0" style="left: {sideWidth}px; width: {viewWidth - sideWidth}px">
            {#if collapsed}
              <div class="absolute top-0 left-0 flex h-10 items-center bg-page pl-2">
                <button class="grid size-7 place-items-center rounded-sm text-ink-45 hover:bg-ink-5 hover:text-ink" aria-label="Show the sidebar" onclick={toggleSidebar}><ChevronsRight size={16} /></button>
              </div>
            {/if}
            <div class="absolute top-0 right-0 flex h-10 items-center gap-1 bg-page pr-2 pl-1 before:absolute before:inset-y-0 before:-left-6 before:w-6 before:bg-linear-to-l before:from-page before:to-transparent">
              <SelectMenu class="text-ink-45" label="Date property" value={dateProperty.name} choices={dateChoices} disabled={!canEdit} onpick={pickDate} />
              <SelectMenu class="text-ink-45" label="Period" value={period} choices={[{ value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year" }]} onpick={setPeriod} />
              <button class="grid size-7 place-items-center rounded-sm text-ink-45 hover:bg-ink-5 hover:text-ink" aria-label="Earlier" onclick={() => scroller?.scrollBy({ left: -(period === "month" ? 7 : period === "quarter" ? 30 : 90) * DAY_PX, behavior: "smooth" })}><ChevronLeft size={16} /></button>
              <button class="item item-normal item-hug" onclick={() => scrollTo(today - 3)}>Today</button>
              <button class="grid size-7 place-items-center rounded-sm text-ink-45 hover:bg-ink-5 hover:text-ink" aria-label="Later" onclick={() => scroller?.scrollBy({ left: (period === "month" ? 7 : period === "quarter" ? 30 : 90) * DAY_PX, behavior: "smooth" })}><ChevronRight size={16} /></button>
            </div>
          </div>
          <div class="flex h-10">
            {#each months as m (m.start)}
              <div class="flex h-full shrink-0 items-center" style="width: {m.days * DAY_PX}px">
                <span class="sticky px-2 font-medium whitespace-nowrap" style="left: {sideWidth + (collapsed ? 40 : 12)}px">{m.label}</span>
              </div>
            {/each}
          </div>
          <div class="flex h-8 text-[12px] text-ink-45">
            {#each days as d (d)}
              {@const labelled = d === today || period === "month" || (period === "quarter" && new Date(d * DAY_MS).getUTCDay() === 1)}
              <div class="grid shrink-0 place-items-center overflow-visible" style="width: {DAY_PX}px">
                {#if labelled}<span class="grid size-6 shrink-0 place-items-center rounded-full {d === today ? 'bg-hot font-semibold text-accent-ink' : ''}">{new Date(d * DAY_MS).getUTCDate()}</span>{/if}
              </div>
            {/each}
          </div>
        </div>
      </div>

      {#each rows as { row, depth, children, span: s } (row.id)}
        {@const entries = () => pageEntries(row.id, { peek: () => onopen(row.id), more: canEdit ? placeEntries((where) => place(row.id, where, s)) : [] })}
        <div class="group flex border-b border-line/30" style="height: {ROW_PX}px" data-row={row.id} animate:rowFlip>
          {#if sideOut}
            <div class="sticky left-0 z-20 flex shrink-0 animate-appear overflow-hidden bg-(--side) group-hover:bg-(--side-hover) {rowDrag.mark(row.id)}"
              style="width: {sideWidth}px; {held === row.id && sideShift.current ? `transform: translateY(${sideShift.current}px)` : ''}" use:menu={entries}>
              <div class="shrink-0" style="width: {sidePad}px"></div>
              {#each sideColumns as c, i (c.name)}
                {#if !c.definition}
                  <div class="group/title flex h-full shrink-0 items-center gap-1 overflow-hidden pr-1 {i === 0 ? 'pl-4' : 'pl-2'} {sorting.dragging === c.name ? 'bg-(--side) shadow-card' : ''}" style="width: {c.width}px; {sorting.style(c.name)}"
                    role="presentation" onpointerdown={(e) => canEdit && rowDrag.start(e, row.id)}>
                    <RowIcon viewId={view.id} id={row.id} icon={row.icon} {depth} {children} />
                    <button class="flex h-full min-w-0 flex-1 items-center gap-2 pl-1 text-left" data-drags onclick={() => onopen(row.id)}>
                      <span class="overflow-hidden font-medium whitespace-nowrap">{row.title || "Untitled"}</span>
                    </button>
                  </div>
                {:else}
                  {@const column = c.definition}
                  {@const cell = cellOf(row, column)}
                  <div class="flex h-full shrink-0 items-center overflow-hidden pr-1 {i === 0 ? 'pl-4' : 'pl-1'} [&>*]:min-w-0 [&>*]:flex-1 {sorting.dragging === column.name ? 'bg-(--side) shadow-card' : ''}" style="width: {c.width}px; {sorting.style(column.name)}">
                    <PropertyValue
                      definition={cell.definition}
                      value={cell.value as Value | undefined}
                      editable={canEdit}
                      pageId={cell.own ? row.id : undefined}
                      onchange={(value) => pages.setProperty(row.id, cell.definition.name, value, cell.own ? undefined : column)}
                    />
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
          <div class="relative shrink-0" style="width: {days.length * DAY_PX}px">
            {#if s}
              {@const dragging = drag?.id === row.id ? drag : null}
              {@const springing = held === row.id}
              {@const at = dragging ? dragged(dragging) : s}
              {@const where = dragging || springing ? "in" : side(s)}
              {#if where === "in"}
                <button
                  class="group/bar absolute top-1 h-6 rounded-sm bg-surface text-left text-[13px] shadow-panel transition-colors hover:bg-[color-mix(in_srgb,var(--surface),var(--text)_6%)] {dragging?.moved ? 'z-10 cursor-grabbing shadow-lg' : springing ? 'z-10' : 'cursor-grab'}"
                  style={springing
                    ? `left: ${bar.current.x}px; width: ${bar.current.w}px; transform: translateY(${bar.current.y}px)`
                    : `left: ${(at.start - first) * DAY_PX}px; width: ${(at.end - at.start + 1) * DAY_PX}px`}
                  onpointerdown={(e) => begin(e, row.id, s, "move")}
                  onpointermove={move}
                  onpointerup={end}
                  use:menu={entries}
                  ><!-- As in Notion: the bar is as long as the dates, its title and values run on past it, fading on hover. -->
                  <span class="pointer-events-none absolute inset-y-0 left-2.5 flex items-center gap-2.5 whitespace-nowrap transition-opacity group-hover/bar:opacity-70">
                    <span class="font-medium">{row.title || "Untitled"}</span>
                    {#each barColumns as column (column.name)}
                      {@const cell = cellOf(row, column)}
                      {#if !blank(cell.value)}
                        <span class="text-[12px] text-ink-45"><PropertyValue definition={cell.definition} value={cell.value as Value} editable={false} onchange={() => {}} /></span>
                      {/if}
                    {/each}
                  </span>
                  {#if dragging?.moved}
                    <!-- Under the bar (over it the header could hide it): the date the held edge is on, or the dates the
                         whole bar would take. -->
                    <span class="pointer-events-none absolute top-full mt-1 rounded-sm bg-surface px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink shadow-panel {dragging.mode === 'end' ? 'right-0' : 'left-0'}"
                      >{dragging.mode === "start" ? shortDate(at.start) : dragging.mode === "end" ? shortDate(at.end) : at.start === at.end ? shortDate(at.start) : `${shortDate(at.start)} – ${shortDate(at.end)}`}</span>
                  {/if}
                  {#if canEdit}
                    <span class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-sm hover:bg-accent/40" role="separator" aria-label="Change start" onpointerdown={(e) => begin(e, row.id, s, "start")} onpointermove={move} onpointerup={end}></span>
                    <span class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-sm hover:bg-accent/40" role="separator" aria-label="Change end" onpointerdown={(e) => begin(e, row.id, s, "end")} onpointermove={move} onpointerup={end}></span>
                  {/if}
                </button
                >
              {:else}
                <!-- Held to the edge in sight by `sticky`, so it does not trail the scroll. -->
                <div class="pointer-events-none sticky h-full" style="left: {sideWidth}px; width: {viewWidth - sideWidth}px">
                  <button
                    class="pointer-events-auto absolute top-1 grid size-6 place-items-center rounded-sm bg-surface text-ink-45 shadow-panel hover:text-ink {where === 'before' ? 'left-1.5' : 'right-1.5'}"
                    aria-label="Go to {row.title || 'Untitled'}"
                    onclick={() => scrollTo(s.start)}
                  >
                    {#if where === "before"}<ArrowLeft size={14} />{:else}<ArrowRight size={14} />{/if}
                  </button>
                </div>
              {/if}
            {:else if canEdit}
              <!-- Unscheduled: a faint bar follows the pointer to the day it points at; a click schedules it there, a drag
                   from one day to another schedules it across them. -->
              <button
                class="absolute inset-0 {pointing?.id === row.id && pointing.from !== null ? 'cursor-grabbing' : 'cursor-pointer'}"
                aria-label="Schedule {row.title || 'Untitled'}"
                onpointermove={(e) => pointing?.from == null && point(row.id, e.currentTarget, e.clientX)}
                onpointerdown={(e) => press(row.id, e)}
                onpointerleave={() => pointing?.from === null && (pointing = null)}
              >
                {#if pointing?.id === row.id}
                  {@const held = pointing.from !== null}
                  <!-- Faint while only pointed at; once pressed it is the bar being drawn, held as a dragged bar is. -->
                  <span class="pointer-events-none absolute top-1 z-10 h-6 rounded-sm bg-surface transition-[opacity,box-shadow] duration-150 {held ? 'shadow-lg' : 'opacity-50 shadow-panel'}"
                    style="left: {ghost.current.x}px; width: {Math.max(DAY_PX / 2, ghost.current.w)}px">
                    <span class="absolute inset-y-0 left-2.5 flex items-center text-[13px] font-medium whitespace-nowrap {held ? 'opacity-70' : ''}">{row.title || "Untitled"}</span>
                    {#if held && pointing.from !== null}
                      {@const forward = pointing.day >= pointing.from}
                      <span class="absolute top-full mt-1 rounded-sm bg-surface px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink shadow-panel {forward ? 'right-0' : 'left-0'}">{shortDate(pointing.day)}</span>
                    {/if}
                  </span>
                {/if}
              </button>
            {/if}
          </div>
        </div>
      {/each}
      {#if batch.more}<div use:batch.sentinel class="h-px"></div>{/if}
      {#if canEdit && !batch.more}
        <!-- "New" is the last row, under the pages: a page made from it starts today. -->
        <div class="flex animate-appear" style="height: {ROW_PX}px" use:followRows={rows.length}>
          {#if sideOut}
            <!-- Clipped as the rows are: its padding alone is wider than the sidebar while that hides. -->
            <div class="sticky left-0 z-20 shrink-0 overflow-hidden bg-(--side)" style="width: {sideWidth}px">
              <button class="flex h-full w-full items-center gap-2 whitespace-nowrap text-ink-45 transition-colors hover:bg-(--side-hover) hover:text-ink" style="padding-left: {sidePad + 20}px"
                onclick={addToday}><Plus size={16} /> New</button>
            </div>
          {/if}
        </div>
      {/if}
      {#if sideOut}
        <!-- The sidebar's own ground below its rows, so the calendar's shading does not show through. -->
        <div class="sticky left-0 z-20 bg-(--side)" style="width: {sideWidth}px; height: {bodyHeight - (rows.length + (canEdit && !batch.more ? 1 : 0)) * ROW_PX}px"></div>
      {/if}
      {#if canEdit}
        <!-- Held to the box's bottom right however far it is scrolled: a new page without going to the last row. -->
        <div class="pointer-events-none sticky bottom-0 left-0 z-40 h-0" style="width: {viewWidth}px">
          <button
            class="group/new pointer-events-auto absolute right-3 bottom-3 flex h-8 items-center rounded-sm bg-surface px-2 text-[13px] text-ink-45 shadow-panel transition-colors hover:text-ink"
            aria-label="New page"
            onclick={addToday}
          ><Plus size={16} class="shrink-0" /><span class="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover/new:max-w-24 group-hover/new:pl-1.5 group-hover/new:opacity-100 group-focus-visible/new:max-w-24 group-focus-visible/new:pl-1.5 group-focus-visible/new:opacity-100">New page</span></button>
        </div>
      {/if}
    </div>
  </div>
{/if}
