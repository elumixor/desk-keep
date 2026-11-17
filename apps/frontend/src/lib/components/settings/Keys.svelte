<script lang="ts">
  import { api } from "$lib/api";
  import { notices } from "$lib/stores/notices.svelte";
  import Section from "./Section.svelte";
  import Secret from "./Secret.svelte";
  import TextField from "../ui/TextField.svelte";

  type Key = Awaited<ReturnType<typeof api.me.tokens.$get>>[number];
  let keys = $state<Key[]>([]);
  let name = $state("");
  let issued = $state<string | null>(null);
  const origin = location.origin;

  const load = () => api.me.tokens.$get().then((list) => (keys = list), notices.error.bind(notices));
  $effect(() => void load());

  async function add(event: SubmitEvent) {
    event.preventDefault();
    try {
      issued = (await api.me.tokens.$post({ name })).secret;
      name = "";
      await load();
    } catch (error) {
      notices.error(error);
    }
  }

  async function revoke(id: string) {
    try {
      await api.me.tokens(id).$delete();
      await load();
    } catch (error) {
      notices.error(error);
    }
  }
</script>

<Section title="Your keys" about="For assistants and scripts acting as you — Claude Code, say. A key sees every workspace you are in.">
  {#if keys.length}
    <ul class="divide-y divide-line overflow-hidden rounded-md shadow-panel">
      {#each keys as key (key.id)}
        <li class="flex items-center gap-2 px-3 py-2">
          <span class="flex-1 truncate">{key.name}</span>
          <span class="font-mono text-[11px] text-ink-30">{key.lastUsedAt ? `used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "never used"}</span>
          <button class="text-[13px] text-ink-30 hover:text-hot" onclick={() => revoke(key.id)}>Revoke</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if issued}
    <Secret label="Shown once. To connect Claude Code:" value={`claude mcp add --transport http keep ${origin}/mcp --header "Authorization: Bearer ${issued}"`} />
  {/if}
  <form class="flex gap-2" onsubmit={add}>
    <TextField class="flex-1" required placeholder="What it is for" bind:value={name} aria-label="Key name" />
    <button class="h-8 rounded-sm bg-accent px-3 font-medium text-accent-ink transition-opacity hover:opacity-90">Create key</button>
  </form>
</Section>
