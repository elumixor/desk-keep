<script lang="ts">
  import { SettingsDialog, type SettingsSection } from "@desk/core/settings";
  import { KeyRound, Keyboard as KeyboardIcon, Palette, Puzzle, Users, Webhook } from "lucide-svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import Appearance from "./Appearance.svelte";
  import Extensions from "./Extensions.svelte";
  import Keyboard from "./Keyboard.svelte";
  import Keys from "./Keys.svelte";
  import Members from "./Members.svelte";
  import Webhooks from "./Webhooks.svelte";

  /** The suite's settings dialog over this workspace; webhooks only for its owner. */
  let { workspaceId, role }: { workspaceId: string; role: string } = $props();
  const owner = $derived(role === "owner");

  const sections = $derived<SettingsSection[]>([
    { id: "members", label: "People", icon: Users, keywords: "members guests invite email role owner access share" },
    { id: "extensions", label: "Extensions", icon: Puzzle, keywords: "apps plugins manifest property types actions token" },
    ...(owner ? [{ id: "webhooks", label: "Webhooks", icon: Webhook, keywords: "notifications other apps events post secret url" }] : []),
    { id: "keys", label: "Your keys", icon: KeyRound, keywords: "tokens api mcp claude code scripts" },
    { id: "appearance", label: "Appearance", icon: Palette, keywords: "theme dark light mode" },
    { id: "keyboard", label: "Keyboard", icon: KeyboardIcon, keywords: "vim zed shortcuts keys completion autocomplete ghost ai tab" },
  ]);
</script>

<SettingsDialog {sections} bind:open={settings.open} bind:active={settings.section}>
  {#snippet section(entry)}
    {#if entry.id === "members"}<Members {workspaceId} {owner} />

    {:else if entry.id === "extensions"}<Extensions {workspaceId} {owner} />
    {:else if entry.id === "webhooks"}<Webhooks {workspaceId} />
    {:else if entry.id === "keys"}<Keys />
    {:else if entry.id === "appearance"}<Appearance />
    {:else if entry.id === "keyboard"}<Keyboard />
    {/if}
  {/snippet}
</SettingsDialog>
