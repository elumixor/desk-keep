<script lang="ts">
  import { viewIcon } from "$lib/view-icon";
  import { tick } from "svelte";
  import { latinize } from "@desk/editor/latin-key";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { ChevronRight, Ellipsis, FileText, FolderInput, PencilLine, Plus, Shapes, Table2, Trash2 } from "lucide-svelte";
  import type { NodeKind } from "$model/nodes";
  import { local } from "$lib/sync/local.svelte";
  import { focusEditor } from "../editor/focus";
  import { createPage, movePage, pageHref, renamePage } from "$lib/actions";
  import { synced } from "$lib/sync/client.svelte";
  import { moveSelected, trashSelected } from "$lib/bulk";
  import { pageEntries, trashPage } from "$lib/page-menu";
  import { contextMenu, menu, type MenuEntries } from "$lib/stores/context-menu.svelte";
  import { palette } from "$lib/stores/palette.svelte";
  import { tree } from "$lib/stores/tree.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import KindPill from "../ui/KindPill.svelte";
  import { workspace, type TreeNode } from "$lib/stores/workspace.svelte";
  import { access } from "$lib/stores/access.svelte";
  import TreeItem from "./TreeItem.svelte";
  import TextField from "../ui/TextField.svelte";
  import { drag, drop } from "./drop";

  let { node, depth = 0, dragging = $bindable(null) }: { node: TreeNode; depth?: number; dragging?: string | null } = $props();

  const expanded = $derived(tree.expanded.has(node.row.id));
  /** Under a trait or view, whether its folded pages are listed. */
  /** How many pages it stands for, after its title: its pages fold into that instead of being listed. */
  const count = $derived(local.pageCount(node.pair?.view.id ?? node.row.id, node.pages.length));
  const openable = $derived(node.children.length > 0);
  let dropZone = $state<"before" | "inside" | null>(null);
  const selected = $derived(tree.selected.has(node.row.id));
  const active = $derived(page.params.page === node.row.id || (!!node.pair && [node.pair.view.id, node.pair.trait.id].includes(page.params.page ?? "")));

  /** Long lists show this many children at first; "N more" lists the next batch. */
  const BATCH = 10;
  let limit = $state(BATCH);
  const has = (of: TreeNode, id: string): boolean => of.row.id === id || of.children.some((c) => has(c, id));
  /** The open page's row stays listed, even past the limit. */
  const shown = $derived.by(() => {
    const id = page.params.page;
    const at = id ? node.children.findIndex((c) => has(c, id)) : -1;
    return node.children.slice(0, Math.max(limit, at + 1));
  });

  function toggle() {
    tree.set(node.row.id, !expanded);
  }

  function onDragOver(event: DragEvent) {
    if (!dragging || dragging === node.row.id) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropZone = event.clientY - box.top < box.height / 3 ? "before" : "inside";
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    const id = dragging;
    const zone = dropZone;
    dropZone = null;
    dragging = null;
    if (!id || id === node.row.id || !zone) return;
    if (zone === "inside") tree.set(node.row.id, true);
    await drop(id, zone === "inside" ? node.row.id : (node.row.parentId ?? ""), zone === "inside" ? null : node.row.id, zone === "inside");
  }

  async function addChild(kind: NodeKind = "page") {
    tree.set(node.row.id, true);
    await createPage(node.row.id, { kind });
  }

  let row = $state<HTMLDivElement>();
  const menuOpen = $derived(!!row && contextMenu.owner === row);

  /** On a row picked with others, what to do to them all; else to this page, and what to add under it. */
  function entries(): MenuEntries {
    const many = tree.selected.size;
    if (selected && many > 1)
      return [
        { label: `Move ${many} pages into…`, icon: FolderInput, run: moveSelected },
        { label: `Move ${many} pages to trash`, icon: Trash2, danger: true, run: trashSelected },
      ];
    const editable = access.can(node.row.id, "write");
    return pageEntries(node.row.id, {
      open: false,
      more: [
        editable && { label: "Rename", icon: PencilLine, run: startRename },
        editable && { label: "Move into…", icon: FolderInput, run: startMove },
        "separator",
        editable && { label: "Add a page inside", icon: Plus, run: () => void addChild() },
        editable && { label: "Add a view inside", icon: Table2, run: () => void addChild("view") },
        editable && { label: "Add a trait inside", icon: Shapes, run: () => void addChild("trait") },
      ],
    });
  }

  let renaming = $state(false);

  function startRename() {
    renaming = true;
    queueMicrotask(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-tree-id="${node.row.id}"] input[data-rename]`);
      input?.focus();
      input?.select();
    });
  }

  function endRename(input: HTMLInputElement, save: boolean) {
    if (!renaming) return;
    renaming = false;
    if (save && input.value !== node.row.title) renamePage(node.row.id, input.value);
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-tree-id="${node.row.id}"] a`)?.focus());
  }

  function descendants(of: TreeNode): string[] {
    const paired = of.pair ? [of.pair.view.id, of.pair.trait.id].filter((id) => id !== of.row.id) : [];
    return [...paired, ...[...of.children, ...of.pages].flatMap((child) => [child.row.id, ...descendants(child)])];
  }

  /** The tree's rows in the order shown, without the workspace's own; an "N more" stands for the pages it hides. */
  const order = (from: HTMLElement) =>
    [...from.closest('[role="tree"]')!.querySelectorAll<HTMLElement>("[data-tree-id], [data-tree-more]")]
      .flatMap((row) => (row.dataset.treeId ? [row.dataset.treeId] : (row.dataset.treeMore ?? "").split(" ")))
      .filter((id) => id && id !== workspace.id);

  function startMove() {
    const exclude = new Set([node.row.id, ...descendants(node)]);
    if (node.row.parentId) exclude.add(node.row.parentId);
    palette.pick("Move into…", exclude, (parentId) => {
      palette.hide();
      tree.set(parentId, true);
      const id = node.row.id;
      movePage(id, parentId, null);
      // The row is drawn again under its new parent: focus follows it there.
      void tick().then(() => document.querySelector<HTMLElement>(`[data-tree-id="${id}"] a`)?.focus());
    });
  }

  /** The open page starts a ⌘ selection, as it anchors a ⇧ range. */
  function pickOpen(clicked?: string) {
    const open = page.params.page;
    if (!tree.selected.size && open && open !== clicked && open !== workspace.id) tree.pick(open);
  }

  /** A click opens the page and keeps the row focused, so the arrows and j/k go on from it. */
  function onClick(event: MouseEvent) {
    const link = event.currentTarget as HTMLElement;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      pickOpen(node.row.id);
      tree.toggleSelect(node.row.id);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      tree.selectRange(node.row.id, order(link), tree.anchor ?? page.params.page ?? null);
      return;
    }
    tree.clearSelection();
    if (node.row.id === page.params.page) {
      event.preventDefault();
      focusEditor();
      return;
    }
    void tick().then(() => link.focus());
  }

  /** The children "N more" stands for; ⌘/⇧-clicking it picks them instead of listing them. */
  const hidden = $derived(node.children.slice(shown.length).map((c) => c.row.id));
  const hiddenSelected = $derived(hidden.length > 0 && hidden.every((id) => tree.selected.has(id)));
  /** "N more" as `tree.last`, when it was the row picked last. */
  const moreKey = $derived(`more:${node.row.id}`);

  function onMore(event: MouseEvent) {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      limit = shown.length + BATCH;
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      // The range runs to the hidden pages, and takes all of them along.
      tree.selectRange(hidden[0], order(event.currentTarget as HTMLElement), tree.anchor ?? page.params.page ?? null);
      for (const id of hidden) tree.pick(id);
    } else if (hiddenSelected) for (const id of hidden) tree.unpick(id);
    else {
      pickOpen();
      for (const id of hidden) tree.pick(id);
    }
    tree.anchor ??= hidden[0];
    tree.last = hiddenSelected ? moreKey : null;
  }

  function onKey(event: KeyboardEvent) {
    latinize(event);
    // `u` as in Vim; ⌘Z is the window's (Shortcuts).
    if (event.key === "u" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      synced.undo();
      return;
    }
    if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && ["ArrowDown", "ArrowUp", "J", "K"].includes(event.key)) {
      const links = [...(event.currentTarget as HTMLElement).closest('[role="tree"]')!.querySelectorAll<HTMLElement>("[data-tree-id] a")];
      const next = links[links.indexOf(event.currentTarget as HTMLElement) + (event.key === "ArrowDown" || event.key === "J" ? 1 : -1)];
      if (next) {
        if (!tree.selected.size) tree.pick(node.row.id);
        tree.anchor ??= node.row.id;
        const id = next.closest<HTMLElement>("[data-tree-id]")!.dataset.treeId!;
        if (tree.selected.has(id) && tree.selected.has(node.row.id) && tree.selected.size > 1 && id !== tree.anchor) tree.unpick(node.row.id);
        else tree.pick(id);
        tree.last = id;
        next.focus();
      }
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (tree.selected.size && ["m", "d", "Delete", "Backspace", "Escape"].includes(event.key)) {
      if (event.key === "m") moveSelected();
      else if (event.key === "Escape") tree.clearSelection();
      else trashSelected();
      event.preventDefault();
      return;
    }
    if (["ArrowDown", "ArrowUp", "j", "k"].includes(event.key)) {
      const links = [...(event.currentTarget as HTMLElement).closest('[role="tree"]')!.querySelectorAll<HTMLElement>("[data-tree-id] a")];
      links[links.indexOf(event.currentTarget as HTMLElement) + (event.key === "ArrowDown" || event.key === "j" ? 1 : -1)]?.focus();
    } else if (event.key === "Escape") document.querySelector<HTMLElement>('[data-testid="editor"]')?.focus();
    else if (event.key === "r") startRename();
    else if (event.key === "m") startMove();
    else if (["d", "Delete", "Backspace"].includes(event.key)) {
      const links = [...(event.currentTarget as HTMLElement).closest('[role="tree"]')!.querySelectorAll<HTMLElement>("[data-tree-id] a")];
      const at = links.indexOf(event.currentTarget as HTMLElement);
      const listed = (of: TreeNode): number => of.children.reduce((n, c) => n + 1 + listed(c), 0);
      const next = links[at + 1 + (expanded ? listed(node) : 0)] ?? links[at - 1];
      void trashPage(node.row.id).then(() => tick()).then(() => next?.isConnected && next.focus());
    }
    else return;
    event.preventDefault();
  }

  const Icon = $derived(node.row.kind === "view" ? viewIcon(node.row.id) : node.row.kind === "trait" ? Shapes : FileText);
</script>

<div
  role="treeitem"
  data-tree-id={node.row.id}
  aria-selected={active || selected}
  aria-expanded={openable ? expanded : undefined}
  tabindex="-1"
  class="group relative"
  ondragover={onDragOver}
  ondragleave={() => (dropZone = null)}
  ondrop={onDrop}
>
  {#if dropZone === "before"}<div class="absolute inset-x-2 top-0 h-0.5 rounded-full bg-accent"></div>{/if}
  <div
    bind:this={row}
    use:menu={entries}
    class="relative flex h-7 items-center gap-0.5 rounded-sm pr-1 transition-colors has-[a:focus-visible]:text-ink {active ? 'font-medium text-ink' : 'text-ink-70 hover:text-ink'} {selected && tree.last === node.row.id ? 'bg-accent/25 hover:bg-accent/30 has-[a:focus-visible]:bg-accent/30' : dropZone === 'inside' || selected ? 'bg-accent-soft hover:bg-accent/20 has-[a:focus-visible]:bg-accent/20' : active ? 'bg-ink-10' : 'hover:bg-ink-5 has-[a:focus-visible]:bg-ink-10'}"
    style="padding-left: {depth * 12 + 6}px"
  >
    {#if openable}
      <button
        class="absolute top-1/2 z-10 grid size-5 -translate-y-1/2 place-items-center rounded-xs text-ink-45 opacity-0 transition-opacity hover:bg-ink-10 hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100"
        style="left: {depth * 12 + 4}px"
        aria-label={expanded ? "Collapse" : "Expand"}
        onclick={toggle}
      >
        <ChevronRight size={14} class="transition-transform {expanded ? 'rotate-90' : ''}" />
      </button>
    {/if}
    <a
      href={tree.shift ? undefined : pageHref(node.row.id)}
      tabindex={tree.shift ? -1 : undefined}
      draggable="true"
      data-sveltekit-keepfocus
      ondragstart={() => {
        drag.alone = false;
        dragging = node.row.id;
        if (!selected) tree.clearSelection();
      }}
      ondragend={() => (dragging = null)}
      class="flex min-w-0 flex-1 items-center gap-2 self-stretch outline-none"
      onkeydown={onKey}
      onclick={onClick}
    >
      <span class="grid w-4 shrink-0 place-items-center transition-opacity {openable ? 'group-hover:opacity-0 group-focus-within:opacity-0 max-md:opacity-0' : ''}">
        {#if node.row.icon}
          <IconGlyph icon={node.row.icon} class="shrink-0" />
        {:else}
          <Icon size={16} class="text-ink-45" />
        {/if}
      </span>
      {#if renaming}
        <TextField
          data-rename
          class="h-6 flex-1 rounded-xs px-1"
          value={node.row.title}
          placeholder="Untitled"
          onclick={(e) => e.preventDefault()}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") endRename(e.currentTarget, true);
            else if (e.key === "Escape") endRename(e.currentTarget, false);
          }}
          onblur={(e) => endRename(e.currentTarget, true)}
        />
        <KindPill kind={node.row.kind} id={node.row.id} />
      {:else}
        <span class="min-w-0 truncate">{node.row.title || "Untitled"}</span>
        {#if node.pair}
          {#each [node.pair.view, node.pair.trait] as part, i (part.id)}
            <span
              role="link"
              tabindex="-1"
              draggable="true"
              class="{i ? '-ml-2' : '-ml-0.5'} inline-flex shrink-0 cursor-pointer items-center rounded-full px-1.5 py-1 leading-4 text-ink-45 hover:bg-ink-10 hover:text-ink {page.params.page === part.id ? 'text-ink' : ''}"
              title={part.kind}
              ondragstart={(e) => { e.stopPropagation(); drag.alone = true; dragging = part.id; }}
              ondragend={() => (dragging = null)}
              onclick={(e) => { e.preventDefault(); e.stopPropagation(); void goto(pageHref(part.id)); }}
              onkeydown={() => {}}
            >{#if part.kind === "view"}{@const PartIcon = viewIcon(part.id)}<PartIcon size={11} />{:else}<Shapes size={11} />{/if}</span>
          {/each}
        {:else}
          <KindPill kind={node.row.kind} id={node.row.id} class="-ml-0.5" />
        {/if}
        <span class="-ml-1.5 min-w-0 flex-1 truncate"
          >{#if count}<span
            class="cursor-grab rounded-full px-1.5 py-1 text-[12px] text-ink-30 hover:bg-ink-10"
            data-testid="page-count"
            role="presentation"
            draggable="true"
            ondragstart={(e) => { e.stopPropagation(); drag.alone = false; drag.folded = node.pages.map((p) => p.row.id); dragging = node.row.id; tree.clearSelection(); }}
            ondragend={() => { drag.folded = null; dragging = null; }}
              >{count.shown === count.total ? count.total : `${count.shown}/${count.total}`} {count.total === 1 ? "page" : "pages"}</span
            >{/if}</span
        >
      {/if}
    </a>
    <div class="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100 {menuOpen ? 'opacity-100' : ''}">
      <button
        class="grid size-6 place-items-center rounded-xs text-ink-45 hover:bg-ink-10 hover:text-ink"
        aria-label="Page actions"
        aria-expanded={menuOpen}
        data-menu-trigger
        onclick={(e) => row && contextMenu.toggleBelow(e.currentTarget, entries(), row)}
      >
        <Ellipsis size={16} />
      </button>
      <button class="grid size-6 place-items-center rounded-xs text-ink-45 hover:bg-ink-10 hover:text-ink" aria-label="Add a page inside" onclick={() => addChild()}>
        <Plus size={16} />
      </button>
    </div>
  </div>
</div>
{#if expanded}
  {#each shown as child (child.row.id)}
    <TreeItem node={child} depth={depth + 1} bind:dragging />
  {/each}
  {#if shown.length < node.children.length}
    <button
      class="flex h-7 w-full items-center rounded-sm text-[13px] text-ink-45 transition-colors hover:text-ink {hiddenSelected && tree.last === moreKey ? 'bg-accent/25 hover:bg-accent/30' : hiddenSelected ? 'bg-accent-soft hover:bg-accent/20' : 'hover:bg-ink-5'}"
      style="padding-left: {(depth + 1) * 12 + 30}px"
      data-tree-more={hidden.join(" ")}
      onclick={onMore}
    >
      {node.children.length - shown.length} more
    </button>
  {/if}
{/if}
