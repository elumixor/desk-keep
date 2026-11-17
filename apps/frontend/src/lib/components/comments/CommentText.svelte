<script lang="ts">
  import { pageHref } from "$lib/actions";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import { parseRefs } from "$model/refs";
  import { pageIdOf, personIdOf } from "$model/urn";
  import PageMention from "../editor/PageMention.svelte";
  import PersonMention from "../editor/PersonMention.svelte";

  /** A comment's text as it reads: its `[Label](urn)` mentions drawn as on a page (a page's pill, a person's), the rest as typed. */
  let { text, class: extra = "" }: { text: string; class?: string } = $props();

  const segments = $derived(parseRefs(text));
</script>

<!-- One line: the text keeps its own spaces and line breaks (pre-wrap), so the markup adds none. -->
<p class={extra}>{#each segments as segment, i (i)}{#if segment.ref}{@const page = pageIdOf(segment.ref.urn)}{@const person = personIdOf(segment.ref.urn)}{#if page}<a class="mention has-icon item-inline no-underline" href={pageHref(page)} data-id={segment.ref.urn}><PageMention id={page} label={segment.ref.label} saved={null} /></a>{:else if person}<a class="mention has-icon item-inline no-underline" href={peopleApi.url(person)} target="_blank" rel="noopener" data-id={segment.ref.urn}><PersonMention id={person} label={segment.ref.label} /></a>{:else}{segment.ref.label}{/if}{:else}{segment.text}{/if}{/each}</p>
