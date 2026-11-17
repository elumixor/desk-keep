<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import { NodeSelection } from "@tiptap/pm/state";
  import { GripVertical, Plus } from "lucide-svelte";

  /**
   * Notion's block handles: hovering a block (or a list item) shows "+" to add a block under it, which opens the
   * slash menu, and a grip that drags the block somewhere else or, clicked, selects it.
   */
  let { editor, area }: { editor: Editor; area: HTMLElement } = $props();

  const SIZE = 24;
  let block = $state<{ el: HTMLElement; pos: number; top: number; left: number } | null>(null);

  const LIST_ITEMS = ":scope > ul > li, :scope > ol > li, :scope > div > ul > li, :scope > div > ol > li";
  const within = (el: Element, y: number) => {
    const r = el.getBoundingClientRect();
    return y >= r.top - 3 && y <= r.bottom + 3;
  };

  /**
   * The innermost block under a height on screen: a list's item rather than the list, a nested item over its parent.
   * The title's line, with what sits around it, has no handle.
   */
  function elementAt(y: number): HTMLElement | null {
    let candidates = ([...editor.view.dom.children] as HTMLElement[]).filter((c) => !("pageHead" in c.dataset));
    let found: HTMLElement | null = null;
    for (;;) {
      const hit = candidates.find((c) => within(c, y));
      if (!hit) return found;
      found = hit;
      if (hit.tagName === "UL" || hit.tagName === "OL") candidates = [...hit.children] as HTMLElement[];
      else if (hit.tagName === "LI") {
        const nested = [...hit.querySelectorAll<HTMLElement>(LIST_ITEMS)];
        if (!nested.some((n) => within(n, y))) return found;
        candidates = nested;
      } else return found;
    }
  }

  function positionOf(el: HTMLElement): number | null {
    const { view } = editor;
    const inside = view.posAtDOM(el, 0);
    if (view.nodeDOM(inside) === el) return inside;
    const resolved = view.state.doc.resolve(inside);
    for (let depth = resolved.depth; depth > 0; depth--) if (view.nodeDOM(resolved.before(depth)) === el) return resolved.before(depth);
    return null;
  }

  function onmove(event: MouseEvent) {
    if (!editor.isEditable || (event.target as HTMLElement).closest("[data-block-handle]")) return;
    if (document.querySelector("[data-popover]") || (event.target as HTMLElement).closest("[data-page-head], [data-view-block]")) {
      block = null;
      return;
    }
    const el = elementAt(event.clientY);
    if (!el) return;
    if (block?.el === el) return;
    const pos = positionOf(el);
    if (pos === null) return;
    const box = el.getBoundingClientRect();
    const frame = area.getBoundingClientRect();
    const style = getComputedStyle(el);
    const line = Number.parseFloat(style.lineHeight) || SIZE;
    const firstLine = el.tagName === "LI" ? 0 : Number.parseFloat(style.paddingTop) || 0;
    const bullet = el.tagName === "LI" && el.dataset.type !== "taskItem" ? 22 : 0;
    block = {
      el,
      pos,
      top: box.top - frame.top + firstLine + Math.max(0, (Math.min(line, box.height) - SIZE) / 2),
      left: box.left - frame.left - bullet - SIZE * 2 - 4,
    };
  }

  $effect(() => {
    area.addEventListener("mousemove", onmove);
    const leave = () => (block = null);
    area.addEventListener("mouseleave", leave);
    return () => {
      area.removeEventListener("mousemove", onmove);
      area.removeEventListener("mouseleave", leave);
    };
  });

  function add() {
    if (!block) return;
    const node = editor.state.doc.nodeAt(block.pos);
    if (!node) return;
    const after = block.pos + node.nodeSize;
    const isItem = node.type.name === "listItem" || node.type.name === "taskItem";
    if (isItem) editor.chain().focus().setTextSelection(after - 2).splitListItem(node.type.name).insertContent("/").run();
    else editor.chain().insertContentAt(after, { type: "paragraph" }).focus(after + 1).insertContent("/").run();
    block = null;
  }

  function select() {
    if (!block) return;
    const { view } = editor;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, block.pos)));
    view.focus();
  }

  function dragstart(event: DragEvent) {
    if (!block || !event.dataTransfer) return;
    const { view } = editor;
    const selection = NodeSelection.create(view.state.doc, block.pos);
    view.dispatch(view.state.tr.setSelection(selection));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "");
    event.dataTransfer.setDragImage(block.el, 0, 0);
    (view as { dragging: unknown }).dragging = { slice: selection.content(), move: true, node: selection };
  }
</script>

{#if block}
  <div
    data-block-handle
    class="absolute z-10 flex items-center text-ink-30 max-md:hidden"
    style="top: {block.top}px; left: {block.left}px"
    contenteditable="false"
  >
    <button class="grid size-6 place-items-center rounded-xs transition-colors hover:bg-ink-5 hover:text-ink-70" aria-label="Add a block below" onclick={add}>
      <Plus size={16} />
    </button>
    <button
      class="grid h-6 w-[18px] cursor-grab place-items-center rounded-xs transition-colors hover:bg-ink-5 hover:text-ink-70 active:cursor-grabbing"
      aria-label="Drag to move, click to select"
      draggable="true"
      ondragstart={dragstart}
      ondragend={() => (block = null)}
      onclick={select}
    >
      <GripVertical size={16} />
    </button>
  </div>
{/if}
