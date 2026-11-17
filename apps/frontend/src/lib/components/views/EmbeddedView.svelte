<script lang="ts">
  import { GanttChart, GripVertical, Kanban, Link2, List, Table } from "lucide-svelte";
  import { pageHref } from "$lib/actions";
  import { local } from "$lib/sync/local.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import ViewBody from "./ViewBody.svelte";
  import ViewToolbar from "./ViewToolbar.svelte";

  /**
   * A view shown inline in a page's body: its name (opening the view) and settings over what it selects; `oncollapse`
   * turns it back into a link.
   */
  let {
    viewId,
    canEdit,
    oncollapse,
    onselect,
    ondragstart,
  }: {
    viewId: string;
    canEdit: boolean;
    oncollapse?: () => void;
    onselect?: () => void;
    ondragstart?: (event: DragEvent) => void;
  } = $props();

  const ICON = { table: Table, board: Kanban, list: List, timeline: GanttChart } as const;
  const view = $derived(local.view(viewId));
  const node = $derived(local.page(viewId));
</script>

<div class="font-ui not-prose" data-testid="embedded-view" data-view={viewId}>
  {#if view && node}
    {@const Icon = ICON[view.kind]}
    <div class="view-rule flex items-center gap-2">
      <div class="flex min-w-0 items-center">
        {#if ondragstart}
          <!-- The block's handle: the view's icon turns into a grip while hovered; it drags the block, clicked selects it. -->
          <button
            class="group/grip grid size-7 cursor-grab place-items-center rounded-sm hover:bg-ink-5 active:cursor-grabbing"
            aria-label="Drag to move, click to select"
            draggable="true"
            {ondragstart}
            onclick={onselect}
          >
            <span class="group-hover/grip:hidden">{#if node.icon}<IconGlyph icon={node.icon} />{:else}<Icon size={16} class="text-ink-45" />{/if}</span>
            <GripVertical size={16} class="hidden text-ink-70 group-hover/grip:block" />
          </button>
        {:else if node.icon}<IconGlyph icon={node.icon} />{:else}<Icon size={16} class="text-ink-45" />{/if}
        <a href={pageHref(viewId)} class="flex h-9 min-w-0 items-center rounded-sm px-1 text-[14px] font-medium hover:bg-ink-5">
          <span class="max-w-[32ch] truncate">{node.title || "Untitled view"}</span>
        </a>
      </div>
      <div class="ml-auto flex shrink-0 items-center">
        <ViewToolbar {view} {canEdit} />
        {#if oncollapse}
          <button class="grid size-7 place-items-center rounded-sm text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink" title="Show as a link" aria-label="Show as link" onclick={oncollapse}><Link2 size={16} /></button>
        {/if}
      </div>
    </div>
    <div class="view-full pt-2"><ViewBody {view} {canEdit} /></div>
  {:else if local.ready}
    <div class="flex h-16 items-center text-[13px] text-ink-30">This view is gone.</div>
  {:else}
    <div class="h-16 text-[13px] text-ink-30">Loading view…</div>
  {/if}
</div>
