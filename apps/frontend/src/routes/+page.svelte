<script lang="ts">
  import { goto } from "$app/navigation";
  import { access } from "$lib/stores/access.svelte";
  import { lastWorkspace, workspace } from "$lib/stores/workspace.svelte";

  /**
   * Straight to the last workspace when the device knows it; the list is asked for only when it does not. Somebody
   * who belongs to no workspace and has pages shared with them lands on the first of those.
   */
  $effect(() => {
    const last = lastWorkspace();
    if (last && workspace.list.some((w) => w.id === last)) {
      void goto(`/w/${last}`, { replaceState: true });
      return;
    }
    void workspace.loadList().then(async (list) => {
      const target = list.find((w) => w.id === last) ?? list[0];
      if (target) return void goto(`/w/${target.id}`, { replaceState: true });
      await access.load();
      const shared = access.sharedRoots[0];
      if (shared) void goto(`/w/${shared.workspaceId}/p/${shared.pageId}`, { replaceState: true });
    });
  });
</script>

<div class="grid h-dvh place-items-center"><div class="size-5 animate-spin rounded-full border-2 border-line border-t-ink"></div></div>
