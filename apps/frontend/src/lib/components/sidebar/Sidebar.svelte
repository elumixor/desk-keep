<script lang="ts">
  import { CloudOff, House, Inbox as InboxIcon, LogOut, PanelLeftClose, Plus, Settings, Shapes, Table2, Trash2 } from "lucide-svelte";
  import { menuKey } from "$lib/menu-key";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { createPage } from "$lib/actions";
  import { api } from "$lib/api";
  import { auth } from "$lib/auth.svelte";
  import { stopSync, synced } from "$lib/sync/client.svelte";
  import { SIDEBAR_COLLAPSE, sidebar } from "$lib/stores/sidebar.svelte";
  import { me } from "$lib/stores/me.svelte";
  import { confirm } from "$lib/stores/confirm.svelte";
  import { notices } from "$lib/stores/notices.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { access } from "$lib/stores/access.svelte";
  import Avatar from "../properties/Avatar.svelte";
  import PageMention from "../editor/PageMention.svelte";
  import Popover from "../ui/Popover.svelte";
  import MenuItem from "../ui/MenuItem.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import Separator from "../ui/Separator.svelte";
  import Skeleton from "../ui/Skeleton.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import Trash from "./Trash.svelte";
  import Inbox from "./Inbox.svelte";
  import { inbox } from "$lib/stores/inbox.svelte";
  import TreeItem from "./TreeItem.svelte";
  import SharedWithMe from "./SharedWithMe.svelte";
  import { drop } from "./drop";
  import { tree } from "$lib/stores/tree.svelte";
  import { contextMenu } from "$lib/stores/context-menu.svelte";
  import TextField from "../ui/TextField.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let accountOpen = $state(false);
  let trashOpen = $state(false);
  let inboxOpen = $state(false);
  let dragging = $state<string | null>(null);
  let query = $state("");
  let cursor = $state(0);
  const matches = $derived(workspace.list.filter((w) => w.title.toLowerCase().includes(query.trim().toLowerCase())));
  /** A workspace the person only has shares in: its tree, trash and settings are not theirs. */
  const visiting = $derived(!!workspace.id && !access.member(workspace.id));
  const visited = $derived(access.sharedRoots.find((s) => s.workspaceId === workspace.id));
  const current = $derived(workspace.current ?? (visited ? { ...visited.workspace } : undefined));
  const writes = $derived(access.writesIn(workspace.id));
  const home = $derived(Boolean(workspace.id) && !page.params.page);
  const row = "flex h-7 w-full items-center gap-2 rounded-sm px-2 text-ink-70 transition-colors hover:bg-ink-5 hover:text-ink [&>svg]:text-ink-45";
  const action = "grid size-6 place-items-center rounded-xs text-ink-45 hover:bg-ink-10 hover:text-ink";

  /** Focuses the switcher's input; closing it puts focus back where it was, unless something else took it. */
  function focusAndReturn(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.focus();
    return () => {
      const active = document.activeElement;
      if (previous?.isConnected && (!active || active === document.body || active === node)) previous.focus();
    };
  }

  $effect(() => {
    void workspace.loadList();
    access.start();
  });

  /** Listens on the window: collapsing unmounts this sidebar, and the same drag must still be able to bring it back. */
  function startResize(event: PointerEvent) {
    const left = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().left;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (e: PointerEvent) => {
      const width = e.clientX - left;
      sidebar.open = width >= SIDEBAR_COLLAPSE;
      if (sidebar.open) sidebar.resize(width);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      sidebar.saveWidth();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  $effect(() => {
    if (sidebar.switcher) {
      query = "";
      cursor = Math.max(0, workspace.list.findIndex((w) => w.id === workspace.id));
    }
  });

  function onSwitcherKey(event: KeyboardEvent, close: () => void) {
    const last = matches.length; // one past the workspaces = "New workspace"
    const key = menuKey(event);
    if (key === "ArrowDown") cursor = Math.min(last, cursor + 1);
    else if (key === "ArrowUp") cursor = Math.max(0, cursor - 1);
    else if (event.key === "Enter") {
      const typed = query;
      close();
      if (cursor === last) newWorkspace(typed);
      else if (matches[cursor]) {
        const id = matches[cursor].id;
        void goto(`/w/${id}`).then(() => tree.reveal(id));
      }
    } else return;
    event.preventDefault();
  }

  /** Asks for the name, starting from what was typed in the switcher. */
  function newWorkspace(typed = "") {
    confirm.prompt("Name the new workspace", "Create", (title) => void createWorkspace(title), typed.trim());
  }

  async function createWorkspace(title: string) {
    try {
      const created = await api.workspaces.$post({ title });
      await workspace.loadList();
      await synced.sync();
      await goto(`/w/${created.id}`);
      await tree.reveal(created.id);
    } catch (error) {
      notices.error(error);
    }
  }

  /** A click anywhere but on a tree row (or a menu or dialog acting on the selection) lets the selection go. */
  function clearOutside(event: PointerEvent) {
    if (!tree.selected.size) return;
    if ((event.target as Element).closest('[data-tree-id], [data-tree-more], [role="menu"], [role="dialog"], [role="alertdialog"]')) return;
    tree.clearSelection();
  }

  /** A right click on the tree but off its rows offers what to add at the workspace's top level. */
  function onTreeMenu(event: MouseEvent) {
    const id = workspace.id;
    if (!id || !access.writesIn(id) || (event.target as Element).closest("[data-tree-id], [data-tree-more], a, button")) return;
    event.preventDefault();
    contextMenu.showFor(event, [
      { label: "Add a page", icon: Plus, run: () => void createPage(id) },
      { label: "Add a view", icon: Table2, run: () => void createPage(id, { kind: "view" }) },
      { label: "Add a trait", icon: Shapes, run: () => void createPage(id, { kind: "trait" }) },
    ]);
  }
</script>

<svelte:window onpointerdown={clearOutside} />

<aside
  style:--sidebar-width="{sidebar.width}px"
  class="relative flex w-(--sidebar-width) shrink-0 flex-col bg-sidebar md:z-10 md:shadow-[8px_0_12px_-6px_var(--edge-shadow-strong)] text-[14px] max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:w-72 max-md:shadow-float"
>
  <div
    class="min-h-0 flex-1 overflow-y-auto px-2 pt-2"
    role="tree"
    tabindex="-1"
    aria-label="Pages"
    oncontextmenu={onTreeMenu}
    ondragover={(e) => { if (dragging && workspace.id) e.preventDefault(); }}
    ondrop={(e) => {
      // Below the rows: the drop goes to the end of the workspace's top level.
      if (e.defaultPrevented || !dragging || !workspace.id) return;
      e.preventDefault();
      const id = dragging;
      dragging = null;
      void drop(id, workspace.id, null);
    }}
  >
    <div class="sticky top-0 z-10 -mx-2 -mt-2 bg-sidebar px-2 pt-2">
    <div
      data-tree-id={workspace.id}
      class="group mb-1 flex h-8 items-center gap-0.5 rounded-sm pr-1 transition-colors has-[a:focus-visible]:bg-ink-10 has-[a:focus-visible]:text-ink {home ? 'bg-ink-10 font-medium text-ink' : 'text-ink-70 hover:bg-ink-5 hover:text-ink'} {sidebar.switcher ? 'bg-ink-5' : ''}"
    >
      <a href={visited ? `/w/${visited.workspaceId}/p/${visited.pageId}` : workspace.id ? `/w/${workspace.id}` : "/"} class="flex min-w-0 flex-1 items-center gap-2 self-stretch pl-1 outline-none" onkeydown={(e) => e.key === "Escape" && document.querySelector<HTMLElement>('[data-testid="editor"]')?.focus()}>
        <span class="grid size-5 shrink-0 place-items-center text-[15px] leading-none font-semibold text-ink-70">{#if current?.icon}<IconGlyph icon={current.icon} size={18} />{:else}{current?.title.slice(0, 1) ?? "K"}{/if}</span>
        <span class="min-w-0 flex-1 truncate font-semibold">{current?.title ?? "…"}</span>
      </a>
      <div class="flex items-center">
        <span class="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          <button class={action} aria-label="Hide sidebar" onclick={onclose}><PanelLeftClose size={16} /></button>
          {#if writes}<button class={action} aria-label="New page" onclick={() => workspace.id && createPage(workspace.id)}><Plus size={16} /></button>{/if}
        </span>
        <Popover bind:open={sidebar.switcher} align="end" width="w-60">
          {#snippet trigger({ toggle })}
            <button class={action} aria-label="Switch workspace" onclick={toggle}><House size={16} /></button>
          {/snippet}
          {#snippet children({ close })}
            <TextField variant="bare"
              {@attach focusAndReturn}
              bind:value={query}
              oninput={() => (cursor = 0)}
              onkeydown={(e) => onSwitcherKey(e, close)}
              class="mb-1 h-8 w-full px-2"
              placeholder="Find a workspace"
            />
            {#each matches as w, i (w.id)}
              <MenuItem active={i === cursor} onclick={() => { close(); void goto(`/w/${w.id}`); }}>
                <span class="mention has-icon min-w-0 truncate"><PageMention id={w.id} label={w.title} saved={w.icon} /></span>
              </MenuItem>
            {/each}
            <Separator />
            <MenuItem active={cursor === matches.length} onclick={() => { const typed = query; close(); newWorkspace(typed); }}><Plus size={16} /> New workspace</MenuItem>
          {/snippet}
        </Popover>
      </div>
    </div>
    <div class="mx-2 mb-1.5 h-px bg-line"></div>
    </div>
    {#if !workspace.loaded && synced.error}
      <p class="px-2 py-1 text-[12px] text-ink-45">Keep could not be reached. Retrying…</p>
    {:else if !workspace.loaded}
      <div class="space-y-2 p-2">
        <Skeleton class="h-4 w-3/4" /><Skeleton class="h-4 w-1/2" /><Skeleton class="h-4 w-2/3" />
      </div>
    {:else}
      {#if !visiting}
        {#each workspace.roots as node (node.row.id)}
          <TreeItem {node} depth={0} bind:dragging />
        {/each}
      {/if}
      <SharedWithMe />
    {/if}
  </div>


  <div class="space-y-px px-2 py-2">
    {#if synced.pendingCount && synced.error}
      <p class="flex h-7 items-center gap-2 px-2 text-[12px] text-ink-45" data-testid="sync-status" title={synced.error}>
        <CloudOff size={14} /> Offline · {synced.pendingCount === 1 ? "1 change" : `${synced.pendingCount} changes`} waiting
      </p>
    {/if}
    <!-- Everyone has an inbox, a visitor with shares only too. -->
    <Popover bind:open={inboxOpen} width="w-80" block>
      {#snippet trigger({ toggle })}
        <button class={row} aria-expanded={inboxOpen} onclick={toggle}>
          <InboxIcon size={16} /> Inbox
          {#if inbox.unread}<span class="ml-auto rounded-full bg-accent px-1.5 text-[11px] leading-4 font-medium text-accent-ink" aria-label="{inbox.unread} unread">{inbox.unread > 99 ? "99+" : inbox.unread}</span>{/if}
        </button>
      {/snippet}
      {#snippet children({ close })}
        <Inbox onclose={close} />
      {/snippet}
    </Popover>
    {#if !visiting}
      <Popover bind:open={trashOpen} block>
        {#snippet trigger({ toggle })}
          <button class={row} aria-expanded={trashOpen} onclick={toggle}><Trash2 size={16} /> Trash</button>
        {/snippet}
        {#snippet children({ close })}
          <Trash onclose={close} />
        {/snippet}
      </Popover>
    {/if}
    <Popover bind:open={accountOpen} width="w-56" block>
      {#snippet trigger({ toggle })}
        <button class="{row} h-9" aria-label="Account" onclick={toggle}>
          <Avatar name={me.current?.name ?? "?"} src={me.current?.avatar} />
          <span class="min-w-0 flex-1 truncate text-left">{me.current?.name ?? "…"}</span>
        </button>
      {/snippet}
      {#snippet children({ close })}
        <MenuItem onclick={() => { close(); settings.show(); }}><Settings size={16} /> Settings <kbd class="ml-auto font-mono text-[11px] text-ink-30" aria-hidden="true">⌘⇧,</kbd></MenuItem>
        <Separator />
        <MenuItem onclick={() => { close(); void auth.signOut(stopSync); }}><LogOut size={16} /> Sign out</MenuItem>
      {/snippet}
    </Popover>
  </div>
  <div
    class="absolute inset-y-0 -right-1 z-50 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:opacity-50 hover:after:bg-ink-20 max-md:hidden"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    onpointerdown={startResize}
  ></div>
</aside>
