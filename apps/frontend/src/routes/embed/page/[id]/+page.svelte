<script lang="ts">
  import { page } from "$app/state";
  import PageView from "$lib/components/page/PageView.svelte";
</script>

<!-- The page without the app around it, for an iframe on another of our sites. -->
<div class="h-dvh overflow-y-auto">
  <PageView id={page.params.id ?? ""} embedded />
</div>
