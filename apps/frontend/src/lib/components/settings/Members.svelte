<script lang="ts">
  import SelectMenu from "../ui/SelectMenu.svelte";
  import { ROLES, type Role } from "$model/roles";
  import { api } from "$lib/api";
  import { notices } from "$lib/stores/notices.svelte";
  import { people } from "$lib/stores/people.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import PersonOrEmailPicker, { type Invitee } from "../people/PersonOrEmailPicker.svelte";
  import Section from "./Section.svelte";

  let { workspaceId, owner }: { workspaceId: string; owner: boolean } = $props();
  let role = $state<Role>("member");
  let busy = $state(false);
  const choices = ROLES.map((r) => ({ value: r, label: r }));
  /** Members already, by People id: the picker leaves them out. */
  const joined = $derived(people.memberIds);

  $effect(() => void people.load(workspaceId, true));

  async function invite(invitee: Invitee) {
    busy = true;
    try {
      const body = "person" in invitee ? { person: invitee.person, role } : { email: invitee.email, role };
      const added = await api.workspaces(workspaceId).members.$post(body);
      notices.show(`${added.name} can now open this workspace`);
      await people.load(workspaceId, true);
    } catch (error) {
      notices.error(error);
    } finally {
      busy = false;
    }
  }

  async function change(personId: string, next: Role) {
    try {
      await api.workspaces(workspaceId).members(personId).$patch({ role: next });
      await people.load(workspaceId, true);
    } catch (error) {
      notices.error(error);
    }
  }

  async function resend(personId: string, name: string) {
    try {
      await api.workspaces(workspaceId).members(personId).resend.$post();
      notices.show(`Invite sent to ${name} again`);
    } catch (error) {
      notices.error(error);
    }
  }

  async function remove(personId: string) {
    try {
      await api.workspaces(workspaceId).members(personId).$delete();
      await people.load(workspaceId, true);
    } catch (error) {
      notices.error(error);
    }
  }
</script>

<Section title="People" about="Owners run the workspace, members edit, guests view and comment. Somebody invited stays pending until they first sign in, with any of their emails.">
  <ul class="divide-y divide-line overflow-hidden rounded-md shadow-panel">
    {#each people.members as member (member.id)}
      <li class="flex items-center gap-2 px-3 py-2">
        <Avatar name={member.name} src={member.avatar} />
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-1.5 truncate">
            <span class="truncate">{member.name}</span>
            {#if member.pending}<span class="rounded-xs bg-ink-5 px-1 text-[11px] text-ink-45">pending</span>{/if}
          </p>
          {#if member.email}<p class="truncate text-[12px] text-ink-45">{member.email}</p>{/if}
        </div>
        {#if owner}
          <SelectMenu class="bg-ink-5 text-[13px]" label="Role" value={member.role} {choices} onpick={(r) => change(member.id, r)} />
          {#if member.pending}
            <button class="text-[13px] text-ink-45 hover:text-ink" onclick={() => resend(member.id, member.name)}>Resend</button>
          {/if}
          <button class="text-[13px] text-ink-30 hover:text-hot" onclick={() => remove(member.id)}>{member.pending ? "Revoke" : "Remove"}</button>
        {:else}
          <span class="font-mono text-[12px] text-ink-30">{member.role}</span>
        {/if}
      </li>
    {/each}
  </ul>
  {#if owner}
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1"><PersonOrEmailPicker exclude={joined} placeholder="Invite by name or email" onpick={(i) => void invite(i)} /></div>
      <SelectMenu class="bg-ink-5" label="Role" value={role} {choices} disabled={busy} onpick={(r) => (role = r)} />
    </div>
  {/if}
</Section>
