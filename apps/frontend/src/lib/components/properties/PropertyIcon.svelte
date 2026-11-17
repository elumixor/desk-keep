<script lang="ts">
  import type { PropertyDefinition } from "$model/properties";
  import { PROPERTY_ICONS } from "$lib/property-icons";
  import { extensions } from "$lib/stores/extensions.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import NamedIcon from "../ui/NamedIcon.svelte";

  /** A property's icon: its own when it has one, else its extension type's, else its type's. */
  let { definition, size = 16, class: className = "" }: { definition: PropertyDefinition; size?: number; class?: string } = $props();
  const TypeIcon = $derived(PROPERTY_ICONS[definition.type]);
  const named = $derived(definition.type === "extension" ? extensions.typeOf(definition)?.icon : undefined);
</script>

{#if definition.icon}
  <IconGlyph icon={definition.icon} {size} class="shrink-0 {className}" />
{:else if named}
  <NamedIcon icon={named} {size} class={className} />
{:else}
  <TypeIcon {size} class="shrink-0 {className}" />
{/if}
