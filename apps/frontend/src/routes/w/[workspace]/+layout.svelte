<script lang="ts">
  import { fade } from "svelte/transition";
  import { page } from "$app/state";
  import Sidebar from "$lib/components/sidebar/Sidebar.svelte";
  import CommandPalette from "$lib/components/search/CommandPalette.svelte";
  import QuickCreate from "$lib/components/search/QuickCreate.svelte";
  import PageBar from "$lib/components/page/PageBar.svelte";
  import TraitChange from "$lib/components/page/TraitChange.svelte";
  import PropertyCodeEditor from "$lib/components/properties/PropertyCodeEditor.svelte";
  import ScriptAsk from "$lib/components/properties/ScriptAsk.svelte";
  import { preloadEditor } from "$lib/components/code/load";
  import { onMount } from "svelte";
  import Shortcuts from "$lib/components/search/Shortcuts.svelte";
  import Settings from "$lib/components/settings/Settings.svelte";
  import { emoji } from "$lib/stores/emoji.svelte";
  import { sidebar } from "$lib/stores/sidebar.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";

  let { children } = $props();

  // The script editor is fetched once the page is up, so opening one later is instant.
  onMount(preloadEditor);

  $effect(() => {
    workspace.open(page.params.workspace ?? "");
  });

  $effect(() => {
    if (workspace.id) void emoji.load(workspace.id);
  });

  $effect(() => {
    void page.url.pathname;
    sidebar.settle();
  });
</script>

<div class="flex h-dvh overflow-hidden bg-page" data-shell>
  {#if sidebar.open}
    {#if sidebar.narrow}
      <div class="fixed inset-0 z-20 bg-[var(--backdrop)]" role="presentation" transition:fade={{ duration: 120 }} onclick={() => sidebar.toggle()}></div>
    {/if}
    <Sidebar onclose={() => sidebar.toggle()} />
  {/if}
  <!-- A column, so a page may take exactly the room under the bar (a timeline filling the screen). -->
  <main class="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
    <PageBar id={page.params.page ?? page.params.workspace ?? ""} />
    {@render children()}
  </main>
</div>
<QuickCreate />
<CommandPalette />
<TraitChange />
<PropertyCodeEditor />
<ScriptAsk />
<Shortcuts />
<!-- Settings are a member's: a visitor with shares only has none here. -->
{#if workspace.id && workspace.current}<Settings workspaceId={workspace.id} role={workspace.current.role} />{/if}
