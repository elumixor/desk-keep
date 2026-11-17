<script lang="ts">
  import { Plus, Shapes } from "lucide-svelte";
  import { createLinkedTrait, updateView } from "$lib/views";
  import Popover from "../ui/Popover.svelte";
  import TraitPicker from "./TraitPicker.svelte";
  import type { View } from "$lib/api";
  import { extensions } from "$lib/stores/extensions.svelte";
  import { people } from "$lib/stores/people.svelte";
  import { viewRows } from "$lib/stores/view-rows.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { selectsNothing } from "$model/views";
  import { chosenParent, createInView, suggestedParent } from "$lib/views";
  import BoardView from "./BoardView.svelte";
  import ListView from "./ListView.svelte";
  import Peek from "./Peek.svelte";
  import TableView from "./TableView.svelte";
  import TimelineView from "./TimelineView.svelte";
  import { palette } from "$lib/stores/palette.svelte";
  import { local } from "$lib/sync/local.svelte";
  import { subtasks } from "./subtasks.svelte";

  /**
   * What one view selects, laid out as it says; "New" makes a page with the view's traits under the view's choice of
   * parent (asked when it has none), and a row opens in the peek.
   */
  /** `fill`: the view takes the height its parent (a flex column) gives it, as a timeline's own page does. */
  let { view, canEdit, fill = false }: { view: View; canEdit: boolean; fill?: boolean } = $props();

  const result = $derived(viewRows.get(view.id));
  let peek = $state<string | null>(null);

  $effect(() => {
    if (!workspace.id) return;
    void people.load(workspace.id);
    void extensions.load(workspace.id);
  });

  function add(properties: Record<string, unknown> = {}) {
    const parent = chosenParent(view);
    if (parent) return make(parent, properties);
    palette.pick("New page goes under…", new Set(), (id) => {
      palette.hide();
      make(id, properties);
    }, [...new Set([suggestedParent(view), view.id])]);
  }

  function make(parentId: string, properties: Record<string, unknown>, before?: string | null) {
    const page = createInView(view, parentId, properties, before);
    if (page) peek = page.id;
  }

  /** A page made by a row: right after it (under the same parent), or as its child, which opens to show it. */
  function place(id: string, where: "after" | "inside", properties: Record<string, unknown> = {}) {
    if (where === "inside") {
      subtasks.open(view.id, id);
      return make(id, properties);
    }
    const parent = local.page(id)?.parentId;
    if (!parent) return;
    const siblings = local.childrenOf(parent);
    make(parent, properties, siblings[siblings.findIndex((s) => s.id === id) + 1]?.id ?? null);
  }

  function close() {
    peek = null;
  }
</script>

<div class="relative {fill ? 'flex min-h-0 flex-1 flex-col' : ''}">
{#if !result}
  <div class="h-24"></div>
{:else if selectsNothing(view)}
  <!-- What the view needs before it can show anything: traits (or a place filter). -->
  <div class="flex justify-center pt-24 pb-12 text-[14px]" data-testid="view-empty">
    {#if canEdit}
      <div class="flex items-center gap-1"><Popover width="w-96">
        {#snippet trigger({ toggle })}
          <button class="item item-normal item-hug text-ink" onclick={toggle}><Shapes size={16} /> Select traits</button>
        {/snippet}
        {#snippet children()}
          <TraitPicker value={view.traits} onchange={(ids) => updateView(view, { traits: ids })} />
        {/snippet}
      </Popover>
      <button class="item item-normal item-hug text-ink" onclick={() => void createLinkedTrait(view)}><Plus size={16} /> Create linked trait</button></div>
    {/if}
  </div>
{:else if view.kind === "table"}
  <TableView {view} {result} {canEdit} {fill} onopen={(id) => (peek = id)} onadd={() => add()} onplace={place} />
{:else if view.kind === "board"}
  <BoardView {view} {result} {canEdit} onopen={(id) => (peek = id)} onadd={add} />
{:else if view.kind === "list"}
  <ListView {view} {result} {canEdit} onopen={(id) => (peek = id)} onadd={() => add()} onplace={place} />
{:else}
  <TimelineView {view} {result} {canEdit} {fill} onopen={(id) => (peek = id)} onadd={add} onplace={place} />
{/if}

</div>

{#if peek}
  <Peek id={peek} onclose={close} />
{/if}
