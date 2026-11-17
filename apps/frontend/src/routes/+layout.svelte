<script lang="ts">
  import "../app.css";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { auth } from "$lib/auth.svelte";
  import { startSync } from "$lib/sync/client.svelte";
  import Confirm from "$lib/components/ui/Confirm.svelte";
  import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
  import Notices from "$lib/components/ui/Notices.svelte";

  let { children } = $props();

  const PUBLIC = ["/sign-in"];

  $effect(() => {
    void auth.load();
  });

  $effect(() => {
    if (auth.signedIn && auth.userId) void startSync(auth.userId);
  });

  $effect(() => {
    if (!auth.loaded || auth.error) return;
    const isPublic = PUBLIC.includes(page.url.pathname);
    if (!auth.signedIn && !isPublic) void goto(`/sign-in?next=${encodeURIComponent(page.url.pathname + page.url.search)}`, { replaceState: true });
  });
</script>

{#if auth.error}
  <div class="grid h-dvh place-items-center p-6 text-center">
    <div class="max-w-sm space-y-3">
      <p class="text-xl font-semibold">Keep could not start</p>
      <p class="text-ink-45">{auth.error}</p>
      <button class="h-8 rounded-sm bg-ink-5 px-3 transition-colors hover:bg-ink-10" onclick={() => location.reload()}>Reload</button>
    </div>
  </div>
{:else if auth.loaded && (auth.signedIn || PUBLIC.includes(page.url.pathname))}
  {@render children()}
{:else}
  <div class="grid h-dvh place-items-center"><div class="size-5 animate-spin rounded-full border-2 border-line border-t-ink"></div></div>
{/if}

<ContextMenu />
<Notices />
<Confirm />
