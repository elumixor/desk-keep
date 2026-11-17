<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import { notices } from "$lib/stores/notices.svelte";

  /** A page by its id alone (`/p/<id>`), for links from other apps that do not know its workspace: on to its place. */
  $effect(() => {
    const id = page.params.id ?? "";
    api
      .pages(id)
      .$get()
      .then(({ workspace }) => goto(workspace.id === id ? `/w/${id}` : `/w/${workspace.id}/p/${id}`, { replaceState: true }))
      .catch((error) => {
        notices.error(error);
        void goto("/", { replaceState: true });
      });
  });
</script>

<div class="grid h-dvh place-items-center"><div class="size-5 animate-spin rounded-full border-2 border-line border-t-ink"></div></div>
