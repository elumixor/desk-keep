<script lang="ts">
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import Avatar from "../properties/Avatar.svelte";

  /** A person named in text: their picture and their name as People has it now (the label they were named by till then). */
  let { id, label }: { id: string; label: string } = $props();

  const person = $derived(peopleApi.person(id));
  const name = $derived(person?.name ?? (label || "Someone"));
</script>

<span class="person-mention" title={person?.emails[0] ?? name}><Avatar {name} src={person?.avatar ?? null} />&#8288;{name}</span>
