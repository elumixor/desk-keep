<script lang="ts">
  import { viewIcon } from "$lib/view-icon";
  import { fade, scale } from "svelte/transition";
  import { FilePlus, FileText, House, Moon, Search, Shapes, Table2, User } from "lucide-svelte";
  import { menuKey } from "$lib/menu-key";
  import DocPreview from "./DocPreview.svelte";
  import { goto } from "$app/navigation";
  import { createPage, createTraitWithView, pageHref } from "$lib/actions";
  import { api } from "$lib/api";
  import type { DocNode } from "$model/document";
  import { PALETTES } from "@desk/core";
  import { sidebar } from "$lib/stores/sidebar.svelte";
  import { palette } from "$lib/stores/palette.svelte";
  import { people } from "$lib/stores/people.svelte";
  import { peopleApi, type PeoplePerson } from "$lib/stores/people-api.svelte";
  import { theme } from "$lib/stores/theme.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { PageSearch } from "../editor/page-search.svelte";
  import Highlighted from "../ui/Highlighted.svelte";
  import IconGlyph from "../ui/IconGlyph.svelte";
  import KindPill from "../ui/KindPill.svelte";
  import type { NodeKind } from "$model/nodes";
  import TextField from "../ui/TextField.svelte";

  interface Item {
    readonly key: string;
    readonly label: string;
    readonly hint?: string;
    readonly icon: string | null;
    readonly nodeKind?: NodeKind;
    readonly kind: "page" | "person" | "command";
    readonly group: string;
    readonly run: () => void;
    /** The label's characters the query matched. */
    readonly matches?: readonly number[];
  }

  const DEBOUNCE_MS = 80;
  let query = $state("");
  let persons = $state<readonly PeoplePerson[]>([]);
  let selected = $state(0);
  let input = $state<HTMLInputElement>();

  interface Preview {
    readonly title: string;
    readonly icon: string | null;
    readonly nodeKind?: NodeKind;
    readonly path: string;
    readonly nodes: readonly DocNode[];
  }

  const PREVIEW_DELAY_MS = 120;
  const PREVIEW_BLOCKS = 14;
  const previews = new Map<string, Preview>();
  let preview = $state<Preview | null>(null);

  async function loadPreview(id: string): Promise<Preview> {
    const cached = previews.get(id);
    if (cached) return cached;
    const { page, ancestors } = await api.pages(id).$get();
    const loaded = {
      title: page.title || "Untitled",
      icon: page.icon,
      nodeKind: page.kind,
      path: ancestors.map((a) => a.title || "Untitled").join(" / "),
      nodes: ((page.body as DocNode | null)?.content ?? []).slice(0, PREVIEW_BLOCKS),
    };
    previews.set(id, loaded);
    return loaded;
  }

  const commands: Item[] = [
    { key: "new-page", group: "Commands", label: "New page", icon: null, kind: "command", run: () => workspace.id && void createPage(workspace.id) },
    { key: "new-db", group: "Commands", label: "New view", icon: null, kind: "command", run: () => workspace.id && void createPage(workspace.id, { kind: "view" }) },
    { key: "new-trait", group: "Commands", label: "New trait", icon: null, kind: "command", run: () => workspace.id && void createPage(workspace.id, { kind: "trait" }) },
    { key: "new-trait-view", group: "Commands", label: "New trait + view", icon: null, kind: "command", run: () => workspace.id && void createTraitWithView(workspace.id) },
    { key: "workspace", group: "Commands", label: "Switch workspace", icon: null, kind: "command", run: () => sidebar.showSwitcher() },
    { key: "theme", group: "Commands", label: "Switch light / dark", icon: null, kind: "command", run: () => theme.toggle() },
    ...(["system", "light", "dark"] as const).map<Item>((mode) => ({ key: `theme:${mode}`, group: "Commands", label: `Mode: ${mode}`, icon: null, kind: "command", run: () => theme.choose({ mode }) })),
    ...PALETTES.map<Item>((p) => ({ key: `theme:${p.id}`, group: "Commands", label: `Theme: ${p.name}`, hint: p.kind, icon: null, kind: "command", run: () => theme.choose({ [p.kind]: p.id, mode: p.kind }) })),
  ];

  const search = new PageSearch(() => query);

  const items = $derived.by((): Item[] => {
    const q = query.trim().toLowerCase();
    const picker = palette.picker;
    const pagesOnly = !!picker || palette.pagesOnly;
    const open = (id: string) => (picker ? picker.onpick(id) : void goto(pageHref(id)));
    const pages = search.items.filter((p) => !picker?.exclude.has(p.id));
    const pinned = picker?.first ?? [];
    if (!q && pinned.length) pages.sort((a, b) => (pinned.indexOf(a.id) + 1 || Infinity) - (pinned.indexOf(b.id) + 1 || Infinity));
    const pageItems: Item[] = (q || pagesOnly ? pages : pages.slice(0, 8)).map((p) => ({
      key: p.id,
      group: p.group ?? (q ? "Pages" : "Recent"),
      label: p.label,
      hint: p.hint,
      icon: p.icon ?? null,
      nodeKind: p.kind,
      kind: "page",
      matches: p.matches,
      run: () => open(p.id),
    }));
    if (pagesOnly) return pageItems;
    // People live in the People app: the workspace's members first, and choosing one opens them there.
    const personItems: Item[] = (q ? persons : [])
      .toSorted((a, b) => Number(people.memberIds.has(b.id)) - Number(people.memberIds.has(a.id)))
      .map((p) => ({ key: `p:${p.id}`, group: "People", label: p.name, hint: p.emails[0], icon: null, kind: "person", run: () => location.assign(peopleApi.url(p.id)) }));
    const commandItems = commands.filter((c) => !q || c.label.toLowerCase().includes(q));
    // Commands first, then pages, then people.
    return [...commandItems, ...pageItems, ...personItems];
  });

  $effect(() => {
    const q = query.trim();
    selected = 0;
    if (!q || palette.picker || palette.pagesOnly) {
      persons = [];
      return;
    }
    const timer = setTimeout(() => {
      peopleApi.search(q).then(
        (result) => {
          if (q === query.trim()) persons = result;
        },
        (error) => console.warn("[People search]", error),
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const selectedPage = $derived(items[selected]?.kind === "page" ? items[selected].key : null);

  $effect(() => {
    const id = selectedPage;
    if (!palette.open || !id) {
      preview = null;
      return;
    }
    const cached = previews.get(id);
    if (cached) {
      preview = cached;
      return;
    }
    const timer = setTimeout(() => {
      loadPreview(id).then(
        (loaded) => {
          if (selectedPage === id) preview = loaded;
        },
        () => {
          if (selectedPage === id) preview = null;
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (palette.open) {
      query = "";
      if (workspace.id) void people.load(workspace.id);
      queueMicrotask(() => input?.focus());
    }
  });

  function onGlobalKey(event: KeyboardEvent) {
    if (event.metaKey &&!event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.open) palette.hide();
      else palette.show();
    }
  }

  function onKey(event: KeyboardEvent) {
    const key = menuKey(event);
    if (key === "ArrowDown") selected = Math.min(items.length - 1, selected + 1);
    else if (key === "ArrowUp") selected = Math.max(0, selected - 1);
    else if (event.key === "Enter") choose(items[selected]);
    else if (event.key === "Escape") palette.hide();
    else return;
    event.preventDefault();
  }

  function choose(item: Item | undefined) {
    if (!item) return;
    palette.hide();
    item.run();
  }
</script>

<svelte:window onkeydown={onGlobalKey} />

{#if palette.open}
  <div class="fixed inset-0 z-50 bg-[var(--backdrop)] px-4" role="presentation" transition:fade={{ duration: 100 }} onmousedown={(e) => e.target === e.currentTarget && palette.hide()}>
    <div class="mx-auto mt-[10vh] flex max-h-[70vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-float" role="dialog" aria-label="Search" transition:scale={{ start: 0.97, duration: 120 }}>
      <div class="flex items-center gap-3 px-5">
        <Search size={18} class="text-ink-45" />
        <TextField variant="bare" bind:ref={input} bind:value={query} onkeydown={onKey} class="h-14 flex-1 text-[17px]" placeholder={palette.picker?.prompt ?? (palette.pagesOnly ? "Find a page…" : "Search or run a command…")} />
      </div>
      <div class="flex min-h-0 flex-1">
      <ul class="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 pb-2" role="listbox">
        {#each items as item, index (item.key)}
          {#if index === 0 || items[index - 1].group !== item.group}
            <li class="px-3 pb-1 pt-3 text-[12px] font-medium text-ink-45" role="presentation">{item.group}</li>
          {/if}
          <li role="option" aria-selected={index === selected}>
            <button class="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left {index === selected ? 'bg-ink-5' : ''}" onmouseenter={() => (selected = index)} onclick={() => choose(item)}>
              <span class="grid w-5 place-items-center text-ink-45">
                {#if item.icon}<IconGlyph icon={item.icon} class="shrink-0" />{:else if item.nodeKind === "view"}{@const ViewIcon = viewIcon(item.key)}<ViewIcon size={18} />{:else if item.nodeKind === "trait"}<Shapes size={18} />{:else if item.kind === "person"}<User size={18} />{:else if item.key === "new-db"}<Table2 size={18} />{:else if item.key === "workspace"}<House size={18} />{:else if item.key.startsWith("theme")}<Moon size={18} />{:else if item.kind === "command"}<FilePlus size={18} />{:else}<FileText size={18} />{/if}
              </span>
              <span class="min-w-0 truncate font-medium"><Highlighted text={item.label} matches={item.matches} /></span><KindPill kind={item.nodeKind} id={item.key} />
              {#if item.hint}<span class="min-w-0 flex-1 truncate text-[13px] text-ink-30">— {item.hint}</span>{:else}<span class="flex-1"></span>{/if}
            </button>
          </li>
        {:else}
          {#if !search.searching}<li class="px-3 py-10 text-center text-ink-30">Nothing matches “{query}”.</li>{/if}
        {/each}
        {#if search.searching}
          <li class="flex items-center gap-2 px-3 py-3 text-[13px] text-ink-30" role="presentation">
            <span class="size-3.5 animate-spin rounded-full border-2 border-line border-t-ink-45"></span>Searching the text of pages…
          </li>
        {/if}
      </ul>
      {#if preview}
        <aside class="mt-2 hidden w-[58%] shrink-0 overflow-hidden rounded-tl-xl border-t border-l border-line bg-surface shadow-float md:block">
          <div class="px-5 pt-5">
            <div class="truncate text-[12px] text-ink-30">{preview.path}</div>
            <h3 class="mt-1 flex items-center gap-2 text-[22px] font-semibold leading-tight">
              {#if preview.icon}<IconGlyph icon={preview.icon} size={22} class="shrink-0" />{:else if preview.nodeKind === "view"}{@const ViewIcon = viewIcon(selectedPage)}<ViewIcon size={22} class="text-ink-45" />{:else if preview.nodeKind === "trait"}<Shapes size={22} class="text-ink-45" />{:else}<FileText size={22} class="text-ink-45" />{/if}<span class="truncate">{preview.title}</span><KindPill kind={preview.nodeKind} id={selectedPage} />
            </h3>
          </div>
          <div class="max-h-full overflow-hidden px-5 py-4 text-[13px] leading-relaxed text-ink-70 [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"><DocPreview nodes={preview.nodes} /></div>
        </aside>
      {/if}
      </div>
    </div>
  </div>
{/if}
