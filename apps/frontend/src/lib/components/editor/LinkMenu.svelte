<script lang="ts">
  import { untrack } from "svelte";
  import { Copy, ExternalLink, Link, Type, Unlink } from "lucide-svelte";
  import { menuKey } from "$lib/menu-key";
  import { notices } from "$lib/stores/notices.svelte";
  import MenuItem from "../ui/MenuItem.svelte";
  import Separator from "../ui/Separator.svelte";
  import { type LinkEdit, normalizeHref } from "./link";
  import TextField from "../ui/TextField.svelte";

  /**
   * What ⌘U shows: the link's address and text, and what can be done with it. Enter in a field keeps what was typed;
   * a link that exists can be opened, copied, removed. Arrows or Ctrl+J / Ctrl+K move between fields and options.
   */
  let {
    initial,
    existing,
    onapply,
    onremove,
  }: {
    initial: LinkEdit;
    existing: boolean;
    onapply: (edit: LinkEdit) => void;
    onremove: () => void;
  } = $props();

  let href = $state(untrack(() => initial.href));
  let text = $state(untrack(() => initial.text));
  let address = $state<HTMLInputElement>();
  let root = $state<HTMLDivElement>();

  $effect(() => {
    address?.focus();
    address?.select();
  });

  const target = $derived(normalizeHref(href));

  $effect(() => {
    const menu = root;
    if (!menu) return;
    const navigate = (event: KeyboardEvent) => {
      const by = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[menuKey(event)];
      if (!by) return;
      event.preventDefault();
      const stops = [...menu.querySelectorAll<HTMLElement>("input, button")];
      const at = stops.indexOf(document.activeElement as HTMLElement);
      stops[(at + by + stops.length) % stops.length]?.focus();
    };
    menu.addEventListener("keydown", navigate);
    return () => menu.removeEventListener("keydown", navigate);
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (target) onapply({ href: target, text });
  }

  async function copy() {
    await navigator.clipboard.writeText(target);
    notices.show("Link copied");
  }
</script>

<div bind:this={root} class="[&_button:focus-visible]:bg-ink-5 [&_button]:outline-none">
  <div class="flex flex-col gap-1">
    <label class="flex h-9 items-center gap-2.5 rounded-md bg-ink-5 px-2.5">
      <Link size={16} class="shrink-0 text-ink-45" />
      <TextField variant="bare"
        bind:ref={address}
        bind:value={href}
        {onkeydown}
        class="flex-1"
        placeholder="Paste or type a link"
        aria-label="Link address"
        spellcheck="false"
      />
    </label>
    <label class="flex h-9 items-center gap-2.5 rounded-md bg-ink-5 px-2.5">
      <Type size={16} class="shrink-0 text-ink-45" />
      <TextField variant="bare"
        bind:value={text}
        {onkeydown}
        class="flex-1"
        placeholder="Text (the link itself if empty)"
        aria-label="Link text"
      />
    </label>
  </div>
  {#if existing}
    <Separator />
    <MenuItem onclick={() => window.open(target, "_blank", "noopener")}><ExternalLink size={16} />Open link</MenuItem>
    <MenuItem onclick={copy}><Copy size={16} />Copy link</MenuItem>
    <MenuItem onclick={onremove} danger><Unlink size={16} />Remove link</MenuItem>
  {/if}
</div>
