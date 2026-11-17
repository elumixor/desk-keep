<script lang="ts" module>
  /** Who a share or an invite is for: a People person by id, or an email People finds or writes down. */
  export type Invitee = { readonly person: string; readonly name: string } | { readonly email: string };
</script>

<script lang="ts">
  import { Mail } from "lucide-svelte";
  import { PeopleSearch } from "$lib/stores/people-search.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * Picks somebody to share with or invite: People search (the workspace's members first, those in `exclude` left
   * out), or "Invite <email>" when what is typed is an email address.
   */
  let {
    onpick,
    exclude = new Set<string>(),
    placeholder = "Name or email",
    limit = 6,
  }: { onpick: (invitee: Invitee) => void; exclude?: ReadonlySet<string>; placeholder?: string; limit?: number } = $props();

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const search = new PeopleSearch();
  const shown = $derived(search.shown.filter((p) => !exclude.has(p.id)).slice(0, limit));
  const email = $derived(EMAIL.test(search.q) ? search.q.toLowerCase() : null);
  const known = $derived(!!email && search.shown.some((p) => p.emails.some((e) => e.toLowerCase() === email)));
  let cursor = $state(0);
  const count = $derived(shown.length + (email && !known ? 1 : 0));

  function pick(invitee: Invitee) {
    search.query = "";
    cursor = 0;
    onpick(invitee);
  }

  function pickAt(index: number) {
    const person = shown[index];
    if (person) pick({ person: person.id, name: person.name });
    else if (email) pick({ email });
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") cursor = Math.min(count - 1, cursor + 1);
    else if (event.key === "ArrowUp") cursor = Math.max(0, cursor - 1);
    else if (event.key === "Enter" && count) pickAt(cursor);
    else return;
    event.preventDefault();
  }
</script>

<!-- A search, not a login: `type="search"` keeps password managers (Bitwarden) from offering to fill it. -->
<TextField
  class="h-8 w-full"
  {placeholder}
  bind:value={search.query}
  aria-label={placeholder}
  oninput={() => (cursor = 0)}
  {onkeydown}
  type="search"
  autocomplete="off"
/>
{#if search.q || shown.length}
  <div class="mt-1" role="listbox" aria-label="People">
    {#each shown as person, i (person.id)}
      <button type="button" role="option" aria-selected={i === cursor} class="menu-item {i === cursor ? 'bg-ink-5' : ''}" onclick={() => pick({ person: person.id, name: person.name })}>
        <Avatar name={person.name} src={person.avatar} />
        <span class="truncate">{person.name}</span>
        {#if person.emails[0]}<span class="ml-auto truncate text-[12px] text-ink-30">{person.emails[0]}</span>{/if}
      </button>
    {/each}
    {#if email && !known}
      <button type="button" role="option" aria-selected={cursor === shown.length} class="menu-item {cursor === shown.length ? 'bg-ink-5' : ''}" onclick={() => pick({ email })}>
        <span class="grid size-5 place-items-center text-ink-45"><Mail size={15} /></span>
        <span class="truncate">Invite {email}</span>
      </button>
    {/if}
  </div>
{/if}
