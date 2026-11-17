<script lang="ts">
  import { ArrowDownLeft } from "lucide-svelte";
  import Item from "../ui/Item.svelte";
  import PageLine from "./PageLine.svelte";

  /** Pages as a property row, one a line (PageLine): by default the ones that link to this one. */
  let {
    linked,
    name = "References",
    icon: Icon = ArrowDownLeft,
    hint = "The pages that link to this one",
    property = "$references",
  }: {
    linked: readonly { id: string; title: string; icon: string | null }[];
    name?: string;
    icon?: typeof ArrowDownLeft;
    hint?: string;
    property?: string;
  } = $props();
</script>

<dt class="min-w-0">
  <Item width="fixed" edge plain title={hint}><Icon size={16} /><span class="truncate">{name}</span></Item>
</dt>
<dd class="flex min-h-8 min-w-0 items-center px-1.5 py-1" data-property={property}>
  {#if linked.length}
    <PageLine {linked} />
  {:else}
    <span class="text-ink-30">None</span>
  {/if}
</dd>
