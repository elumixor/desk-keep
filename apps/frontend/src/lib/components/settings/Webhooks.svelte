<script lang="ts">
  import { EVENTS, type EventType } from "$model/watch";
  import { api } from "$lib/api";
  import { notices } from "$lib/stores/notices.svelte";
  import { now } from "$lib/stores/now.svelte";
  import { brief } from "$lib/time";
  import Section from "./Section.svelte";
  import Secret from "./Secret.svelte";
  import TextField from "../ui/TextField.svelte";

  let { workspaceId }: { workspaceId: string } = $props();
  type Hook = Awaited<ReturnType<ReturnType<typeof api.workspaces>["webhooks"]["$get"]>>[number];
  let hooks = $state<Hook[]>([]);
  let url = $state("");
  let picked = $state<EventType[]>(["page.created", "page.changed", "page.deleted"]);
  let issued = $state<string | null>(null);

  const chip = "rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors";
  const on = "bg-accent-soft text-accent";
  const off = "bg-ink-5 text-ink-45 hover:bg-ink-10 hover:text-ink";

  const STATE: Record<string, string> = { sent: "delivered", pending: "retrying", failed: "failed" };

  const load = () => api.workspaces(workspaceId).webhooks.$get().then((list) => (hooks = list), notices.error.bind(notices));
  $effect(() => void load());

  const flip = (events: readonly string[], event: EventType) =>
    (events.includes(event) ? events.filter((e) => e !== event) : [...events, event]) as EventType[];

  async function add(event: SubmitEvent) {
    event.preventDefault();
    if (!picked.length) return notices.show("Pick at least one event", "error");
    try {
      const hook = await api.workspaces(workspaceId).webhooks.$post({ url, events: picked });
      issued = hook.secret;
      url = "";
      await load();
    } catch (error) {
      notices.error(error);
    }
  }

  async function toggle(hook: Hook, event: EventType) {
    const events = flip(hook.events, event);
    if (!events.length) return notices.show("A webhook needs at least one event; remove it instead", "error");
    try {
      await api.workspaces(workspaceId).webhooks(hook.id).$patch({ events });
      await load();
    } catch (error) {
      notices.error(error);
    }
  }

  async function remove(id: string) {
    try {
      await api.workspaces(workspaceId).webhooks(id).$delete();
      await load();
    } catch (error) {
      notices.error(error);
    }
  }
</script>

<Section title="Notifications to other apps" about="Keep posts the events you pick (pages and comments created, changed or deleted) to these addresses, signed with the secret shown when you add one.">
  {#if hooks.length}
    <ul class="divide-y divide-line overflow-hidden rounded-md shadow-panel">
      {#each hooks as hook (hook.id)}
        <li class="space-y-1.5 px-3 py-2">
          <div class="flex items-center gap-2">
            <span class="flex-1 truncate font-mono text-[12px]">{hook.url}</span>
            <button class="text-[13px] text-ink-30 hover:text-hot" onclick={() => remove(hook.id)}>Remove</button>
          </div>
          <div class="flex flex-wrap gap-1">
            {#each EVENTS as event (event)}
              {@const active = hook.events.includes(event)}
              <button class="{chip} {active ? on : off}" aria-pressed={active} onclick={() => toggle(hook, event)}>{event}</button>
            {/each}
          </div>
          <p class="text-[12px] text-ink-30">
            {#if hook.lastDelivery}
              Last: {hook.lastDelivery.event}, <span class={hook.lastDelivery.state === "failed" ? "text-hot" : ""}>{STATE[hook.lastDelivery.state] ?? hook.lastDelivery.state}</span>
              {brief(hook.lastDelivery.at, now.value)}{#if hook.lastDelivery.error} · {hook.lastDelivery.error}{/if}
            {:else}
              Nothing sent yet.
            {/if}
          </p>
        </li>
      {/each}
    </ul>
  {/if}
  {#if issued}<Secret label="Signing secret — shown once." value={issued} />{/if}
  <form class="space-y-2" onsubmit={add}>
    <div class="flex gap-2">
      <TextField class="flex-1" type="url" required placeholder="https://…/keep-events" bind:value={url} aria-label="Address" />
      <button class="h-8 rounded-sm bg-accent px-3 font-medium text-accent-ink transition-opacity hover:opacity-90">Add</button>
    </div>
    <div class="flex flex-wrap gap-1" role="group" aria-label="Events to send">
      {#each EVENTS as event (event)}
        {@const active = picked.includes(event)}
        <button type="button" class="{chip} {active ? on : off}" aria-pressed={active} onclick={() => (picked = flip(picked, event))}>{event}</button>
      {/each}
    </div>
  </form>
</Section>
