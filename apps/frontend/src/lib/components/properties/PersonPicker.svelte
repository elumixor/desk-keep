<script lang="ts">
  import { Check, ChevronRight, Plus, Star } from "lucide-svelte";
  import type { Assignee } from "$model/properties";
  import { access } from "$lib/stores/access.svelte";
  import { notices } from "$lib/stores/notices.svelte";
  import { peopleApi } from "$lib/stores/people-api.svelte";
  import { PeopleSearch } from "$lib/stores/people-search.svelte";
  import Avatar from "./Avatar.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * People come from the People app: its groups (a group alone is its leader; open one to name a member), the workspace's
   * members, anyone else by search, and "Create" writes a new one there. Somebody set on `pageId` who cannot see it is told of ("… can't see this page", with Share).
   */
  let { value, pageId, onpick }: { value: readonly Assignee[]; pageId?: string; onpick: (value: Assignee[]) => void } =
    $props();

  function added(id: string) {
    if (pageId) void access.warnIfHidden(pageId, [id], "assign");
  }

  const search = new PeopleSearch();
  let creating = $state(false);
  const q = $derived(search.q);

  const has = (id: string) => value.some((a) => a.id === id);
  function toggle(id: string, kind: Assignee["kind"] = "person") {
    if (has(id)) return onpick(value.filter((a) => a.id !== id));
    onpick([...value, { kind, id }]);
    if (kind === "person") added(id);
  }

  let opened = $state<string | null>(null);

  async function create() {
    creating = true;
    try {
      const person = await peopleApi.create(q);
      search.query = "";
      onpick([...value, { kind: "person", id: person.id }]);
      added(person.id);
    } catch (error) {
      notices.error(error);
    } finally {
      creating = false;
    }
  }
</script>

<TextField class="mb-1 h-9 w-full" placeholder="Search people" bind:value={search.query} aria-label="Search people" />
{#each search.groups as group (group.id)}
  <div class="flex items-center">
    <button class="menu-item min-w-0 flex-1" onclick={() => toggle(group.id, "group")}>
      <Avatar name={group.name} src={group.avatar} /> <span class="truncate">{group.name}</span>
      {#if has(group.id)}<Check size={16} class="ml-auto" />{/if}
    </button>
    {#if group.members.length}
      <button class="grid size-7 shrink-0 place-items-center rounded-sm text-ink-45 hover:bg-ink-5 hover:text-ink" aria-label="Members of {group.name}" aria-expanded={opened === group.id} onclick={() => (opened = opened === group.id ? null : group.id)}>
        <ChevronRight size={16} class={opened === group.id ? "rotate-90" : ""} />
      </button>
    {/if}
  </div>
  {#if opened === group.id || (q && group.members.some((m) => m.name.toLowerCase().includes(q.toLowerCase())))}
    {#each group.members as member (member.id)}
      <button class="menu-item pl-6" onclick={() => toggle(member.id)}>
        <span class="relative inline-flex shrink-0">
          <Avatar name={member.name} src={member.avatar} />
          {#if member.id === group.leaderId}<Star size={10} class="absolute -top-1 -right-1 fill-current text-ink-70" aria-label="Group leader" />{/if}
        </span>
        <span class="truncate">{member.name}</span>
        {#if has(member.id)}<Check size={16} class="ml-auto" />{/if}
      </button>
    {/each}
  {/if}
{/each}
{#each search.shown as person (person.id)}
  <button class="menu-item" onclick={() => toggle(person.id)}>
    <Avatar name={person.name} src={person.avatar} /> <span class="truncate">{person.name}</span>
    {#if has(person.id)}<Check size={16} class="ml-auto" />{/if}
  </button>
{/each}
{#if q && !search.exact}
  <button class="menu-item text-ink-45 hover:text-ink" disabled={creating} onclick={create}>
    <span class="grid size-5 place-items-center"><Plus size={16} /></span> <span class="truncate">Create “{q}”</span>
  </button>
{/if}
