<script lang="ts">
  import { page } from "$app/state";
  import PageView from "$lib/components/page/PageView.svelte";
</script>

{#key page.params.page}
  <PageView id={page.params.page ?? ""} />
{/key}
