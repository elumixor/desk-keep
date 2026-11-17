<script lang="ts">
  import { allowedTraits, type PropertyDefinition } from "$model/properties";
  import { type SchemaTarget, setAllowedTraits } from "$lib/schema";
  import { traits } from "$lib/stores/traits.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { local } from "$lib/sync/local.svelte";
  import ChoiceList from "../ui/ChoiceList.svelte";
  import PageGlyph from "../ui/PageGlyph.svelte";
  import Popover from "../ui/Popover.svelte";

  /**
   * A relation's allowed traits as a menu, like SelectMenu: the trigger shows them (any page when none); open, every
   * trait with its glyph and where it lives, under a search field, the allowed ones checked, a pick toggling one.
   */
  let { target, definition, class: extra = "" }: { target: SchemaTarget; definition: PropertyDefinition; class?: string } = $props();

  let open = $state(false);
  const chosen = $derived(allowedTraits(definition));
  const shown = $derived(chosen.map((id) => traits.get(id) ?? { id, name: "Unknown", icon: null }));

  /** Where a trait lives: the pages above it, below the workspace. */
  function path(id: string) {
    const page = local.page(id);
    if (!page) return undefined;
    const above = local.ancestors(page).filter((p) => p.id !== workspace.id);
    return above.length ? above.map((p) => p.title || "Untitled").join(" / ") : undefined;
  }

  const choices = $derived(
    traits.list.map((t) => ({ value: t.id, label: t.name || "Untitled", page: { icon: t.icon, kind: "trait" as const }, hint: path(t.id) })),
  );
  const toggle = (id: string) =>
    setAllowedTraits(target, definition.name, chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]);
</script>

<Popover bind:open width="w-72">
  {#snippet trigger({ toggle: show })}
    <button type="button" class="flex h-8 min-w-0 items-center gap-2 rounded-sm px-2 text-left outline-none transition-colors hover:bg-ink-5 focus-visible:bg-ink-5 {open ? 'bg-ink-5' : ''} {extra}" aria-label="Allowed traits" aria-expanded={open} onclick={show}>
      {#each shown as trait (trait.id)}
        <span class="flex min-w-0 shrink items-center gap-1"><PageGlyph icon={trait.icon} kind="trait" size={14} /><span class="truncate text-ink-70">{trait.name || "Untitled"}</span></span>
      {:else}
        <span class="truncate text-ink-30">Any page</span>
      {/each}
    </button>
  {/snippet}
  {#snippet children()}
    <ChoiceList {choices} label="Allowed traits" selected={chosen} onpick={toggle} />
  {/snippet}
</Popover>
