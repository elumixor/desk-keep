<script lang="ts">
  import { TrashBanner } from "@desk/core/trash";
  import { goto } from "$app/navigation";
  import { pageHref, purgePage, restorePage } from "$lib/actions";

  /** On a page in the trash: the suite's banner, with Keep's restore and delete. */
  let { pageId, parentId, since }: { pageId: string; parentId: string | null; since: string } = $props();

  async function purge() {
    if (await purgePage(pageId)) await goto(parentId ? pageHref(parentId) : "/");
  }
</script>

<TrashBanner {since} onrestore={() => void restorePage(pageId)} onpurge={() => void purge()} />
