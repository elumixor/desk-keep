<script lang="ts">
  import { TrashList } from "@desk/core/trash";
  import { FileText, PanelTop, RotateCcw } from "lucide-svelte";
  import { goto } from "$app/navigation";
  import { pageHref, purgePage, restorePage } from "$lib/actions";
  import { api } from "$lib/api";
  import { menu } from "$lib/stores/context-menu.svelte";
  import { notices } from "$lib/stores/notices.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";

  /** The workspace's trash, in the suite's trash list. */
  let { onclose }: { onclose: () => void } = $props();
  type Item = Awaited<ReturnType<ReturnType<typeof api.workspaces>["trash"]["$get"]>>[number];
  let items = $state<Item[] | null>(null);

  $effect(() => {
    if (workspace.id) api.workspaces(workspace.id).trash.$get().then((list) => (items = list), notices.error.bind(notices));
  });

  function open(item: Item) {
    onclose();
    void goto(pageHref(item.id));
  }

  async function restore(item: Item) {
    await restorePage(item.id);
    onclose();
  }

  async function purge(item: Item) {
    if (await purgePage(item.id)) items = items?.filter((i) => i.id !== item.id) ?? null;
  }
</script>

<TrashList {items} onopen={open} onrestore={(item) => void restore(item)} onpurge={(item) => void purge(item)} href={(item) => pageHref(item.id)}>
  {#snippet lead(item)}
    <span class="contents" use:menu={() => [
      { label: "Open", icon: PanelTop, run: () => open(item) },
      { label: "Restore", icon: RotateCcw, run: () => void restore(item) },
    ]}>{#if item.icon}<IconGlyph icon={item.icon} />{:else}<FileText size={16} />{/if}</span>
  {/snippet}
</TrashList>
