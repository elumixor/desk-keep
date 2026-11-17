<script lang="ts">
  import { ChevronRight, FileText } from "lucide-svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import EmojiPicker from "../ui/EmojiPicker.svelte";
  import Popover from "../ui/Popover.svelte";
  import { pages } from "$lib/stores/pages.svelte";
  import { subtasks } from "./subtasks.svelte";

  /**
   * A view row's icon, indented as deep as the row sits among its parents. A row with children in the view shows,
   * while pointed at (its row is the `group`), the chevron that shows or hides them in the icon's place.
   */
  let {
    viewId,
    id,
    icon,
    depth,
    children,
    editable = false,
  }: { viewId: string; id: string; icon: string | null | undefined; depth: number; children: number; editable?: boolean } = $props();
  const open = $derived(subtasks.isOpen(viewId, id));
  const label = $derived(open ? "Hide children" : `Show ${children} ${children === 1 ? "child" : "children"}`);
</script>

<span class="relative grid size-5 shrink-0 place-items-center" style="margin-left: {depth * 20}px">
  <span class="grid place-items-center transition-opacity duration-150 {children ? 'group-hover:opacity-0' : ''}">
    {#snippet glyph()}{#if icon}<IconGlyph {icon} />{:else}<FileText size={16} class="text-ink-45" />{/if}{/snippet}
    {#if editable}
      {#snippet picker({ close }: { close: () => void })}
        <EmojiPicker current={icon ?? undefined} onpick={(next) => { close(); pages.edit(id, { icon: next }); }} onremove={() => { close(); pages.edit(id, { icon: null }); }} />
      {/snippet}
      <Popover width="w-80" align="start" children={picker}>
        {#snippet trigger({ toggle })}
          <button class="grid size-5 place-items-center rounded-xs hover:bg-ink-10" aria-label="Change icon" onclick={(e) => { e.stopPropagation(); toggle(); }}>{@render glyph()}</button>
        {/snippet}
      </Popover>
    {:else}{@render glyph()}{/if}
  </span>
  {#if children}
    <button
      class="absolute inset-0 grid cursor-pointer place-items-center rounded-xs text-ink-45 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-ink-10 hover:text-ink focus-visible:opacity-100"
      aria-label={label}
      aria-expanded={open}
      title={label}
      onclick={(e) => { e.stopPropagation(); subtasks.toggle(viewId, id); }}
    ><ChevronRight size={14} class="transition-transform duration-150 {open ? 'rotate-90' : ''}" /></button>
  {/if}
</span>
