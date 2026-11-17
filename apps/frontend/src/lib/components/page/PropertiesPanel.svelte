<script lang="ts">
  import type { PropertyDefinition, PropertyType, PropertyValue as Value } from "$model/properties";
  import type { PageData } from "$lib/api";
  import { addOption, addProperty } from "$lib/schema";
  import { extensions } from "$lib/stores/extensions.svelte";
  import { pages } from "$lib/stores/pages.svelte";
  import { people } from "$lib/stores/people.svelte";
  import { traits } from "$lib/stores/traits.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import AddProperty from "../views/AddProperty.svelte";
  import PropertyHeader from "../views/PropertyHeader.svelte";
  import PropertyIcon from "../properties/PropertyIcon.svelte";
  import PropertyValue from "../properties/PropertyValue.svelte";
  import Item from "../ui/Item.svelte";
  import References from "./References.svelte";

  /**
   * The pages that refer to a page, once there are some, apart above; then its properties, each edited here (one a
   * trait has asks first whether the trait changes too); last, adding a property. Its traits are listed under the title (PageView).
   */
  let { data, editable }: { data: PageData; editable: boolean } = $props();
  const page = $derived(data.page);

  $effect(() => {
    if (!workspace.id) return;
    void people.load(workspace.id);
    void extensions.load(workspace.id);
  });

  const shown = (name: string) => page.properties[name] as Value | undefined;
  const add = (type: PropertyType, extra?: Partial<PropertyDefinition>) => void addProperty({ page: page.id }, type, extra);
  const references = $derived([...new Map(data.backlinks.map((b) => [b.id, b])).values()]);
</script>

<div class="-mt-4 text-[14px]" data-testid="properties">
  {#if references.length}
    <!-- The pages that link here: a list of their own above the properties, as a trait's pages are. -->
    <dl class="mb-6 grid grid-cols-[minmax(7rem,10rem)_1fr] gap-x-2" data-testid="references">
      <References linked={references} />
    </dl>
  {/if}
  {#if page.schema.length}
    <dl class="grid grid-cols-[minmax(7rem,10rem)_1fr] gap-x-2 gap-y-px">
      <!-- By position, not name: a rename keeps the row (and its open settings). -->
      {#each page.schema as definition, index (index)}{@render property(definition, editable)}{/each}
    </dl>
  {/if}
  {#if editable}<div class={page.schema.length ? "mt-3" : ""}><AddProperty onpick={add} label="Add property" edge /></div>{/if}
</div>

{#snippet property(definition: PropertyDefinition, canEdit: boolean)}
  {#if canEdit}
    <dt class="min-w-0">
      <PropertyHeader target={{ page: page.id }} {definition} editable={canEdit} edge />
    </dt>
  {:else}
    <dt class="min-w-0">
      <Item width="fixed" edge plain title="Read-only here"><PropertyIcon {definition} /><span class="truncate">{definition.name}</span></Item>
    </dt>
  {/if}
  <dd class="flex min-h-8 min-w-0 items-center gap-1" data-property={definition.name}>
    <span class="min-w-0 flex-1">
      <PropertyValue
        {definition}
        value={shown(definition.name)}
        editable={canEdit}
        pageId={page.id}
        onchange={(value) => pages.setProperty(page.id, definition.name, value)}
        onadd={(name) => (canEdit ? addOption({ page: page.id }, definition.name, name) : "")}
      />
    </span>
  </dd>
{/snippet}
