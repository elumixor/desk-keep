<script lang="ts">
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import { auth } from "$lib/auth.svelte";
  import { peopleApi } from "$lib/stores/people-api.svelte";

  /** One place to choose which of your workspaces someone may reach: `?person=<People id>&next=<url to go back to>`. */
  const ROLE = "member";
  /** Only back into the suite: a link someone sends cannot make this page send you elsewhere. */
  const SUITE = /(^|\.)example\.com$/;

  type Row = { readonly id: string; readonly title: string; readonly icon: string | null; readonly memberId?: string; readonly memberRole?: string };

  const person = $derived(page.url.searchParams.get("person") ?? "");
  const next = $derived.by(() => {
    try {
      const url = new URL(page.url.searchParams.get("next") ?? "");
      return url.protocol === "https:" && SUITE.test(url.hostname) ? url.href : undefined;
    } catch {
      return undefined;
    }
  });
  const name = $derived(peopleApi.person(person)?.name ?? "them");

  let rows = $state<readonly Row[] | undefined>();
  let busy = $state<string | undefined>();
  let error = $state("");

  async function load() {
    const mine = (await api.workspaces.$get()).filter((w) => w.role === "owner");
    rows = await Promise.all(
      mine.map(async (w) => {
        const member = (await api.workspaces(w.id).members.$get()).find((m) => m.peopleId === person);
        return { id: w.id, title: w.title, icon: w.icon, memberId: member?.id, memberRole: member?.role };
      }),
    );
  }

  $effect(() => {
    if (auth.signedIn && person) void load().catch((e: Error) => (error = e.message));
  });

  async function toggle(row: Row) {
    busy = row.id;
    error = "";
    try {
      if (row.memberId) await api.workspaces(row.id).members(row.memberId).$delete();
      else await api.workspaces(row.id).members.$post({ person, role: ROLE });
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
    busy = undefined;
  }
</script>

<main class="grid min-h-dvh place-items-center bg-surface-2 p-4">
  <div class="w-full max-w-md space-y-4">
    <h1 class="text-xl font-semibold">Give {name} access</h1>
    {#if !person}
      <p class="text-sm" role="alert">This link does not say who to give access to.</p>
    {:else if !rows}
      <p class="text-sm opacity-60">Loading your workspaces…</p>
    {:else if !rows.length}
      <p class="text-sm opacity-60">You own no workspaces to share.</p>
    {:else}
      <ul class="space-y-1">
        {#each rows as row (row.id)}
          <li>
            <label class="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-surface">
              <input type="checkbox" checked={Boolean(row.memberId)} disabled={busy !== undefined || row.memberRole === "owner"} onchange={() => void toggle(row)} />
              <span class="min-w-0 flex-1 truncate text-sm">{row.icon ?? ""} {row.title}</span>
              {#if row.memberRole === "owner"}<span class="text-xs opacity-60">owner</span>{/if}
            </label>
          </li>
        {/each}
      </ul>
    {/if}
    {#if error}<p class="text-sm text-red-600" role="alert">{error}</p>{/if}
    {#if next}<a class="inline-block text-sm underline" href={next}>Done</a>{/if}
  </div>
</main>
