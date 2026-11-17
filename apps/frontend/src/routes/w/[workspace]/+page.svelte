<script lang="ts">
  import { page } from "$app/state";
  import PageView from "$lib/components/page/PageView.svelte";
</script>

<PageView id={page.params.workspace ?? ""} />
