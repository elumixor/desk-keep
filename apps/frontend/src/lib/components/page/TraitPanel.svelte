<script lang="ts">
  import { ChevronRight, FileText, Files, Plus } from "lucide-svelte";
  import { TEMPLATE_TITLE } from "$model/views";
  import { createPage, pageHref } from "$lib/actions";
  import { templateOf } from "$lib/views";
  import Item from "../ui/Item.svelte";
  import type { PropertyDefinition, PropertyType } from "$model/properties";
  import type { ViewRecord } from "$model/sync";
  import type { PageData } from "$lib/api";
  import { addProperty } from "$lib/schema";
  import { traits } from "$lib/stores/traits.svelte";
  import { local } from "$lib/sync/local.svelte";
  import AddProperty from "../views/AddProperty.svelte";
  import References from "./References.svelte";
  import TraitProperty from "./TraitProperty.svelte";

  /** A trait's properties: what a page has to have it, each changed here for every page having it; then those pages. */
  let { data, editable, compact = false }: { data: PageData; editable: boolean; compact?: boolean } = $props();
  /** With views of its own (`compact`) the pages are there: the properties fold away, and so does the list. */
  let open = $state(false);
  const template = $derived(templateOf(data.page.id));
  const addTemplate = () => void createPage(data.page.id, { title: TEMPLATE_TITLE });
  const trait = $derived(traits.get(data.page.id));
  const properties = $derived(trait?.properties ?? data.page.schema);
  const add = (type: PropertyType, extra?: Partial<PropertyDefinition>) =>
    void addProperty({ trait: data.page.id }, type, extra);

  const query: ViewRecord = $derived({
    id: data.page.id,
    kind: "list",
    traits: [data.page.id],
    filter: [],
    sort: [],
    groupBy: null,
    visibleProperties: null,
    barProperties: null,
    sortCode: null,
    newParent: null,
    showArchived: false,
    cleanup: null,
  });
  const having = $derived(
    data.page.workspaceId
      ? local.query(data.page.workspaceId, query).rows.map((row) => ({
          id: row.id,
          title: row.title,
          icon: local.pages.get(row.id)?.icon ?? null,
        }))
      : [],
  );
</script>

<div class="-mt-4 text-[14px]" data-testid="trait-properties">
  {#if having.length && !compact}
    <!-- The pages having it: a list of their own, apart from the properties. -->
    <dl class="mb-6 grid grid-cols-[minmax(7rem,10rem)_1fr] gap-x-2" data-testid="trait-pages">
      <References linked={having} name="Pages" icon={Files} hint="The pages having this trait" property="$pages" />
    </dl>
  {/if}
  <div class="item-edge mb-2 flex flex-wrap items-center gap-1">
    {#if compact}
      <Item size="small" onclick={() => (open = !open)} aria-expanded={open}
        ><ChevronRight size={14} class="transition-transform {open ? 'rotate-90' : ''}" />{properties.length} properties</Item
      >
    {/if}
    {#if template}
      <Item size="small" href={pageHref(template.id)} title="New pages having this trait start as this page"><FileText size={14} />Template</Item>
    {:else if editable}
      <Item size="small" class="text-ink-45" onclick={addTemplate} title="A page new pages having this trait start as"><Plus size={14} />Add template</Item>
    {/if}
  </div>
  {#if !compact || open}
    {#each properties as definition, index (index)}
      <TraitProperty traitId={data.page.id} {definition} {editable} />
    {/each}
    {#if editable}<div class="mt-3"><AddProperty onpick={add} label="Add property" edge /></div>{/if}
  {/if}
</div>
