<script lang="ts">
  import { Puzzle, RefreshCw } from "lucide-svelte";
  import type { Manifest } from "$model/extensions";
  import { api } from "$lib/api";
  import { extensions } from "$lib/stores/extensions.svelte";
  import { notices } from "$lib/stores/notices.svelte";
  import NamedIcon from "../ui/NamedIcon.svelte";
  import Section from "./Section.svelte";
  import TextField from "../ui/TextField.svelte";

  let { workspaceId, owner }: { workspaceId: string; owner: boolean } = $props();
  let manifestUrl = $state("");
  let token = $state("");
  let busy = $state(false);

  $effect(() => {
    void extensions.load(workspaceId);
  });

  async function add(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    try {
      const added = await api.workspaces(workspaceId).extensions.$post({ manifestUrl, token });
      manifestUrl = "";
      token = "";
      notices.show(`${added.name} added`);
      await extensions.load(workspaceId, true);
    } catch (error) {
      notices.error(error);
    } finally {
      busy = false;
    }
  }

  async function refresh(id: string) {
    try {
      await api.workspaces(workspaceId).extensions(id).refresh.$post();
      await extensions.load(workspaceId, true);
      notices.show("Manifest fetched again");
    } catch (error) {
      notices.error(error);
    }
  }

  async function remove(id: string) {
    try {
      await api.workspaces(workspaceId).extensions(id).$delete();
      await extensions.load(workspaceId, true);
    } catch (error) {
      notices.error(error);
    }
  }

  const summary = (manifest: Manifest) =>
    [manifest.propertyTypes.length && `${manifest.propertyTypes.length} property type${manifest.propertyTypes.length === 1 ? "" : "s"}`,
      manifest.actions.length && `${manifest.actions.length} action${manifest.actions.length === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" · ");
</script>

<Section title="Extensions" about="Apps plugged into this workspace: they add property types picked from the app, and actions a button's script calls. Keep calls them with the token given here, which never reaches a browser.">
  {#if extensions.list.length}
    <ul class="divide-y divide-line overflow-hidden rounded-md shadow-panel" data-testid="extensions">
      {#each extensions.list as extension (extension.id)}
        {@const manifest = extension.manifest as Manifest}
        <li class="flex items-center gap-2 px-3 py-2">
          {#if manifest.icon}<NamedIcon icon={manifest.icon} />{:else}<Puzzle size={16} class="text-accent" />{/if}
          <span class="min-w-0 flex-1">
            <span class="block truncate">{extension.name}</span>
            <span class="block truncate text-[12px] text-ink-45">{summary(manifest) || "Nothing to add yet"}</span>
          </span>
          <span class="max-w-44 truncate font-mono text-[12px] text-ink-45" title={extension.manifestUrl}>{extension.manifestUrl}</span>
          <button class="grid size-7 place-items-center rounded-sm text-ink-30 transition-colors hover:bg-ink-5 hover:text-ink" aria-label="Fetch {extension.name}'s manifest again" onclick={() => refresh(extension.id)}><RefreshCw size={14} /></button>
          {#if owner}<button class="text-[13px] text-ink-30 hover:text-hot" onclick={() => remove(extension.id)}>Remove</button>{/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if owner}
    <form class="flex flex-wrap gap-2" aria-label="Add an extension" onsubmit={add}>
      <TextField class="flex-[2_1_14rem]" type="url" required placeholder="https://…/manifest.json" bind:value={manifestUrl} aria-label="Manifest URL" />
      <TextField class="flex-[1_1_8rem]" type="password" required placeholder="Token" autocomplete="off" bind:value={token} aria-label="Extension token" />
      <button class="h-8 rounded-sm bg-accent px-3 font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50" disabled={busy}>Add</button>
    </form>
  {/if}
</Section>
