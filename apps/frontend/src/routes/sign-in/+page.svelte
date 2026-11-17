<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { auth } from "$lib/auth.svelte";

  let host = $state<HTMLDivElement>();
  const next = $derived(page.url.searchParams.get("next") ?? "/");

  $effect(() => {
    if (auth.signedIn) {
      void goto(next, { replaceState: true });
      return;
    }
    if (!host) return;
    const mounted = auth.mountSignIn(host, next);
    return () => void mounted.then((unmount) => unmount());
  });
</script>

<main class="grid min-h-dvh place-items-center bg-surface-2 p-4">
  <div class="space-y-6">
    <div class="flex flex-col items-center gap-3">
      <img src="/favicon.svg" alt="" class="size-14" />
      <h1 class="text-center text-3xl font-bold tracking-tight">Keep</h1>
    </div>
    <div bind:this={host}></div>
  </div>
</main>
