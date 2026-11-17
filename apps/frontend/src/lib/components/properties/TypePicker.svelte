<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PropertyDefinition } from "$model/properties";
  import { choiceOf, typeChoices, typePick } from "$lib/property-types";
  import { retype, type SchemaTarget } from "$lib/schema";
  import { extensions } from "$lib/stores/extensions.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import ChoiceList from "../ui/ChoiceList.svelte";
  import Popover from "../ui/Popover.svelte";

  /** Gives a property another type, picked from the same list as a new property's (extensions' types and buttons too). */
  let { target, definition, trigger }: { target: SchemaTarget; definition: PropertyDefinition; trigger: Snippet<[{ toggle: () => void }]> } = $props();
  let open = $state(false);

  $effect(() => {
    if (open && workspace.id) void extensions.load(workspace.id);
  });

  function pick(value: string) {
    open = false;
    const picked = typePick(value);
    if (picked && value !== choiceOf(definition)) retype(target, definition, picked.type, picked.extra);
  }
</script>

<Popover bind:open width="w-56" {trigger}>
  {#snippet children()}
    <ChoiceList label="Property type" choices={typeChoices()} value={choiceOf(definition)} onpick={pick} />
  {/snippet}
</Popover>
