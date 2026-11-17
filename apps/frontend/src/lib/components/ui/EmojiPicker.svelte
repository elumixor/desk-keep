<script lang="ts">
  import { POPUP } from "$lib/popup";
  import { Apple, Car, Clock, Flag, Heart, ImageIcon, ImageUp, Lightbulb, PawPrint, Plus, Smile, Sparkles, Trash2, Trophy, X } from "lucide-svelte";
  import { menuKey } from "$lib/menu-key";
  import { tick, untrack } from "svelte";
  import { formatIcon, ICON_COLORS, parseIcon } from "$model/icons";
  import {
    type AnimatedEntry,
    animatedTerms,
    EMOJI_GROUPS,
    type EmojiEntry,
    emojiTerms,
    type IconEntry,
    iconTerms,
    loadAnimated,
    loadEmoji,
    loadIcons,
    prepareIcon,
    search,
    TONE_SAMPLES,
    toned,
  } from "$lib/emoji";
  import { emoji, type CustomEmoji } from "$lib/stores/emoji.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { access } from "$lib/stores/access.svelte";
  import AddEmoji from "./AddEmoji.svelte";
  import IconGlyph from "./IconGlyph.svelte";
  import TextField from "./TextField.svelte";

  /**
   * Notion's icon picker: emoji by category (with the ones used lately and the workspace's own), Google's animated
   * emoji, and Lucide icons in a colour, each found by searching. `onpick` gets the icon as it is stored; `onremove`,
   * when given, offers taking the icon off. Given `typed` (what follows `:` in a page), it is searched by that instead
   * of its own field, the keys stay where they are typed and reach it through `keydown`, and `onresults` hears how
   * many matches it shows. The Upload tab takes a picture of one's own (kept as `image:<data URL>`).
   */
  let {
    onpick,
    onremove,
    typed,
    onresults,
    iconsOnly = false,
    emojiOnly = false,
    current,
  }: {
    onpick: (icon: string) => void;
    onremove?: () => void;
    typed?: string;
    onresults?: (count: number) => void;
    /** Only plain Lucide icons, in the text's colour: no emoji, animated, custom or uploaded ones, and no colour. */
    iconsOnly?: boolean;
    /** Only plain emoji (a reaction's): no tabs, animated, custom or uploaded ones. */
    emojiOnly?: boolean;
    /** The icon the page has now, marked among the Lucide ones. */
    current?: string | null;
  } = $props();

  type Tab = "emoji" | "animated" | "icons" | "upload";
  const TABS: { key: Tab; label: string }[] = [
    { key: "emoji", label: "Emoji" },
    { key: "animated", label: "Animated" },
    { key: "icons", label: "Icons" },
    { key: "upload", label: "Upload" },
  ];
  const SECTION_ICONS = {
    recent: Clock,
    people: Smile,
    nature: PawPrint,
    food: Apple,
    activities: Trophy,
    travel: Car,
    objects: Lightbulb,
    symbols: Heart,
    flags: Flag,
    custom: Sparkles,
  };
  type SectionKey = keyof typeof SECTION_ICONS;
  /** Lucide has some 1,600 icons, each its own picture: they are drawn a page at a time as the list scrolls. */
  const ICON_PAGE = 160;
  const RESULTS = 200;

  // The tab it opens on; switching tabs is the picker's own from then on.
  let tab = $state<Tab>(untrack(() => iconsOnly) ? "icons" : "emoji");
  let query = $state("");
  let entries = $state.raw<readonly EmojiEntry[]>([]);
  let animated = $state.raw<readonly AnimatedEntry[]>([]);
  let icons = $state.raw<readonly IconEntry[]>([]);
  let failed = $state<Tab | null>(null);
  let iconsShown = $state(ICON_PAGE);
  let toneOpen = $state(false);
  let adding = $state(false);
  /** The match the keys are on, among `results`. */
  let selected = $state(0);
  let scrolledTo = $state<SectionKey | null>(null);
  let body = $state<HTMLDivElement>();
  let more = $state<HTMLDivElement>();
  let grid = $state<HTMLDivElement>();
  let search_ = $state<HTMLInputElement>();

  const q = $derived((typed ?? query).trim().toLowerCase());
  const canAdd = $derived(access.writesIn(workspace.id));
  const byGroup = $derived(
    new Map(EMOJI_GROUPS.map((group) => [group.key, entries.filter((entry) => entry.group === group.key)])),
  );
  const customFound = $derived(
    emojiOnly ? [] : q ? search(emoji.list, q, (e) => ({ names: [e.name], words: [] })) : emoji.list,
  );
  const emojiFound = $derived(q ? search(entries, q, emojiTerms, RESULTS) : []);
  const animatedFound = $derived(emojiOnly ? [] : search(animated, q, animatedTerms));
  /** The icons used lately that this picker offers. */
  const recent = $derived(emojiOnly ? emoji.recent.filter((icon) => parseIcon(icon)?.kind === "emoji") : emoji.recent);
  const iconsFound = $derived(search(icons, q, iconTerms));
  /** What the keys move through and Enter picks: the matches shown, as icons are stored. Sections are not among them. */
  const results = $derived<string[]>(
    tab === "emoji"
      ? q
        ? [
            ...customFound.map(customIcon),
            ...emojiFound.map((entry) => toned(entry, emoji.tone)),
            ...animatedFound.map((entry) => `noto:${entry.code}`),
          ]
        : []
      : tab === "animated"
        ? animatedFound.map((entry) => `noto:${entry.code}`)
        : iconsFound.slice(0, iconsShown).map((entry) => lucide(entry.name)),
  );
  const currentName = $derived.by(() => {
    const parsed = parseIcon(current);
    return parsed?.kind === "lucide" ? parsed.name : null;
  });
  /** The Lucide icons used lately, by name, as `iconsOnly` shows them above the list. */
  const recentIcons = $derived(
    emoji.recent.flatMap((icon) => {
      const parsed = parseIcon(icon);
      return parsed?.kind === "lucide" ? [parsed.name] : [];
    }).filter((name, i, all) => all.indexOf(name) === i),
  );
  const sections = $derived<SectionKey[]>([
    ...(recent.length ? (["recent"] as const) : []),
    ...EMOJI_GROUPS.map((group) => group.key),
    ...(!emojiOnly && (emoji.list.length || canAdd) ? (["custom"] as const) : []),
  ]);
  const active = $derived(scrolledTo ?? sections[0]);

  $effect(() => {
    const wanted = tab;
    failed = null;
    if (wanted === "upload") return;
    const load = wanted === "emoji" ? loadEmoji() : wanted === "animated" ? loadAnimated() : loadIcons();
    load.then(
      (list) => {
        if (wanted === "emoji") entries = list as readonly EmojiEntry[];
        else if (wanted === "animated") animated = list as readonly AnimatedEntry[];
        else icons = list as readonly IconEntry[];
      },
      (error) => {
        console.warn("[emoji] could not load", wanted, error);
        if (tab === wanted) failed = wanted;
      },
    );
  });

  // A search on the emoji tab also lists the animated ones, after the others.
  $effect(() => {
    if (emojiOnly || tab !== "emoji" || !q || animated.length) return;
    loadAnimated().then(
      (list) => (animated = list),
      (error) => console.warn("[emoji] could not load animated", error),
    );
  });

  // The picker opens to be searched.
  $effect(() => search_?.focus());

  $effect(() => {
    void [tab, q];
    iconsShown = ICON_PAGE;
    selected = 0;
    body?.scrollTo({ top: 0 });
  });

  $effect(() => onresults?.(results.length));

  // Icons are drawn a page further each time the end of the list comes into view.
  $effect(() => {
    if (!more || !body) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && (iconsShown += ICON_PAGE),
      { root: body, rootMargin: "200px" },
    );
    observer.observe(more);
    return () => observer.disconnect();
  });

  /** The picture chosen to be the icon, as it would be stored, until it is saved. */
  let uploaded = $state<string | null>(null);
  let uploadProblem = $state<string | null>(null);
  let preparing = $state(false);
  let file = $state<HTMLInputElement>();

  async function prepare(source: Blob | string) {
    preparing = true;
    try {
      uploaded = await prepareIcon(source);
      uploadProblem = null;
    } catch (error) {
      uploadProblem = (error as Error).message;
    } finally {
      preparing = false;
    }
  }

  async function chosen() {
    const picked = file?.files?.[0];
    if (file) file.value = "";
    if (picked) await prepare(picked);
  }

  /** ⌘V on the Upload tab takes a copied image, or a copied link to one. */
  function onpaste(event: ClipboardEvent) {
    if (tab !== "upload" || !event.clipboardData) return;
    const image = [...event.clipboardData.files].find((f) => f.type.startsWith("image/"));
    const text = event.clipboardData.getData("text/plain").trim();
    if (!image && !/^https?:\/\//.test(text)) return;
    event.preventDefault();
    void prepare(image ?? text);
  }

  function ondrop(event: DragEvent) {
    const dropped = event.dataTransfer?.files[0];
    if (!dropped) return;
    event.preventDefault();
    void prepare(dropped);
  }

  function pick(icon: string) {
    emoji.use(icon);
    onpick(icon);
  }

  /** The icon the page has is marked; the rest sit quiet. */
  const iconTone = (name: string) => (name === currentName ? "bg-ink-10 text-ink" : "text-ink-70");

  function lucide(name: string) {
    return formatIcon({ kind: "lucide", name, color: iconsOnly ? null : emoji.color });
  }
  function customIcon(e: CustomEmoji) {
    return formatIcon({ kind: "custom", id: e.id });
  }
  const pickEmoji = (entry: EmojiEntry) => pick(toned(entry, emoji.tone));

  /**
   * The arrows move through the matches (a row at a time up and down, as many as the grid fits across) and Enter picks
   * the one they are on; whether the key was taken.
   */
  export function keydown(event: KeyboardEvent): boolean {
    const count = results.length;
    if (!count) return false;
    if (event.key === "Enter") {
      pick(results[selected] ?? results[0] ?? "");
      return true;
    }
    const across = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 1;
    const by = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across, ArrowDown: across } as Record<string, number>)[menuKey(event)];
    if (!by) return false;
    selected = Math.max(0, Math.min(count - 1, selected + by));
    void tick().then(() => grid?.querySelector("[data-selected=true]")?.scrollIntoView({ block: "nearest" }));
    return true;
  }

  /** Up, down and Enter in the search field reach the matches; left and right stay the field's. */
  function onsearchkey(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && keydown(event)) event.preventDefault();
  }

  /** A cell among `results` (at `index`) is an option the keys and the pointer select; elsewhere `index` is -1. */
  const option = (index: number) =>
    index < 0
      ? {}
      : {
          role: "option",
          "aria-selected": index === selected,
          "data-selected": index === selected,
          onmouseenter: () => (selected = index),
        };
  const lit = (index: number) => (index >= 0 && index === selected ? "bg-ink-5" : "");

  function jumpTo(key: SectionKey) {
    body?.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ block: "start" });
  }

  /** The category bar marks the section scrolled to. */
  function onscroll() {
    if (!body || tab !== "emoji" || q) return;
    const top = body.scrollTop + 8;
    let current: SectionKey = sections[0] ?? "people";
    for (const section of body.querySelectorAll<HTMLElement>("[data-section]"))
      if (section.offsetTop <= top) current = section.dataset.section as SectionKey;
    scrolledTo = current;
  }

  async function removeCustom(e: CustomEmoji) {
    if (!workspace.id || !confirm(`Delete :${e.name}:? Pages that show it will show nothing in its place.`)) return;
    await emoji.remove(workspace.id, e.id);
  }

  const label = (key: SectionKey) =>
    key === "recent" ? "Recent" : key === "custom" ? "Custom" : (EMOJI_GROUPS.find((g) => g.key === key)?.label ?? "");
  const cell = "grid size-9 place-items-center rounded-sm transition-colors hover:bg-ink-5 focus-visible:bg-ink-5 focus-visible:outline-none";
</script>

{#snippet emojiCell(entry: EmojiEntry, index: number)}
  {@const glyph = toned(entry, emoji.tone)}
  <button type="button" class="{cell} {lit(index)} text-[24px] leading-none" title={entry.label} aria-label={entry.label} {...option(index)} onclick={() => pickEmoji(entry)}>{glyph}</button>
{/snippet}

{#snippet customCell(e: CustomEmoji, index: number)}
  <span class="group/custom relative">
    <button type="button" class="{cell} {lit(index)}" title={`:${e.name}:`} aria-label={e.name} {...option(index)} onclick={() => pick(customIcon(e))}>
      <img src={e.image} alt="" class="size-6 object-contain" draggable="false" />
    </button>
    {#if canAdd}
      <button
        type="button"
        class="absolute -top-1 -right-1 hidden size-4 place-items-center rounded-full bg-surface text-ink-45 shadow-panel group-hover/custom:grid hover:text-hot"
        aria-label={`Delete :${e.name}:`}
        onclick={() => removeCustom(e)}><X size={10} /></button
      >
    {/if}
  </span>
{/snippet}

{#snippet addCell()}
  <button type="button" class="{cell} text-ink-45 hover:text-ink" title="Add custom emoji" aria-label="Add custom emoji" onclick={() => (adding = true)}>
    <Plus size={18} />
  </button>
{/snippet}

<svelte:window {onpaste} />

<div class="flex h-[min(26rem,calc(100dvh-2rem))] w-full flex-col" data-testid="emoji-picker">
  <div class="flex items-center gap-1 border-b border-line px-1 pb-1" class:hidden={(iconsOnly && !onremove) || emojiOnly}>
    {#each iconsOnly || emojiOnly ? [] : TABS as t (t.key)}
      <button
        type="button"
        class="h-7 shrink-0 rounded-sm text-[13px] transition-colors {t.key === 'upload' ? 'grid w-8 place-items-center' : 'px-2'} {tab === t.key ? 'bg-ink-5 font-medium text-ink' : 'text-ink-45 hover:bg-ink-5 hover:text-ink'}"
        title={t.label}
        aria-label={t.label}
        onclick={() => (tab = t.key)}>{#if t.key === "upload"}<ImageUp size={16} />{:else}{t.label}{/if}</button
      >
    {/each}
    {#if onremove}
      <button type="button" class="ml-auto grid size-7 shrink-0 place-items-center rounded-sm text-ink-45 transition-colors hover:bg-ink-5 hover:text-hot" title="Remove icon" aria-label="Remove icon" onclick={onremove}><Trash2 size={15} /></button>
    {/if}
  </div>

  {#if tab === "upload"}
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-3" role="presentation" ondragover={(event) => event.preventDefault()} {ondrop}>
      <button
        type="button"
        class="grid min-h-0 flex-1 place-items-center rounded-md bg-ink-5 text-ink-70 transition-colors hover:bg-ink-10"
        onclick={() => file?.click()}
      >
        {#if uploaded}
          <img src={uploaded.slice("image:".length)} alt="" class="size-24 rounded-md object-cover" />
        {:else}
          <span class="flex items-center gap-2"><ImageIcon size={18} />{preparing ? "Reading…" : "Upload an image"}</span>
        {/if}
      </button>
      <input bind:this={file} type="file" accept="image/*" class="hidden" onchange={chosen} />
      <p class="min-h-[18px] text-center text-[12px] {uploadProblem ? 'text-hot' : 'text-ink-30'}">
        {uploadProblem ?? (uploaded ? "Click the picture to choose another" : "or ⌘V to paste an image or link")}
      </p>
      <div class="flex justify-end gap-2">
        <button type="button" class="h-8 rounded-sm px-3 text-ink-70 transition-colors hover:bg-ink-5" onclick={() => (uploaded ? (uploaded = null) : (tab = "emoji"))}>Cancel</button>
        <button
          type="button"
          class="h-8 rounded-sm bg-accent px-3 font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={!uploaded}
          onclick={() => uploaded && onpick(uploaded)}>Save</button
        >
      </div>
    </div>
  {:else}
  <div class="flex items-center gap-1 p-1.5">
    {#if typed === undefined}
      <TextField
        class="flex-1 px-2"
        placeholder={tab === "icons" ? "Search icons" : "Search emoji"}
        aria-label="Search"
        bind:ref={search_}
        bind:value={query}
        onkeydown={onsearchkey}
      />
    {:else}
      <p class="flex h-8 min-w-0 flex-1 items-center truncate rounded-sm bg-ink-5 px-2 ring-2 ring-accent/40">:{typed}</p>
    {/if}
    {#if tab === "emoji"}
      <div class="relative">
        <button type="button" class="{cell} size-8 text-[20px] leading-none" aria-label="Skin tone" onclick={() => (toneOpen = !toneOpen)}>
          {TONE_SAMPLES[emoji.tone]}
        </button>
        {#if toneOpen}
          <div class="absolute top-full right-0 z-10 mt-1 flex {POPUP}">
            {#each TONE_SAMPLES as sample, tone (tone)}
              <button
                type="button"
                class="{cell} size-8 text-[20px] leading-none {tone === emoji.tone ? 'bg-ink-5' : ''}"
                aria-label={tone ? `Tone ${tone}` : "Default tone"}
                onclick={() => {
                  emoji.setTone(tone);
                  toneOpen = false;
                }}>{sample}</button
              >
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if tab === "icons" && !iconsOnly}
    <div class="flex items-center gap-1 px-2 pb-1.5" role="radiogroup" aria-label="Icon colour">
      <button
        type="button"
        role="radio"
        aria-checked={emoji.color === null}
        aria-label="Text colour"
        class="size-5 rounded-full bg-ink-70 ring-offset-1 ring-offset-surface {emoji.color === null ? 'ring-2 ring-accent' : ''}"
        onclick={() => emoji.setColor(null)}
      ></button>
      {#each ICON_COLORS as c (c)}
        <button
          type="button"
          role="radio"
          aria-checked={emoji.color === c}
          aria-label={c}
          class="size-5 rounded-full ring-offset-1 ring-offset-surface {emoji.color === c ? 'ring-2 ring-accent' : ''}"
          style:background-color="var(--hue-{c})"
          onclick={() => emoji.setColor(c)}
        ></button>
      {/each}
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5" bind:this={body} {onscroll}>
    {#if failed === tab}
      <p class="px-1 py-6 text-center text-ink-30">Couldn't load these. Check the connection and try again.</p>
    {:else if tab === "emoji"}
      {#if q}
        {#if customFound.length || emojiFound.length || animatedFound.length}
          <div bind:this={grid} class="grid grid-cols-[repeat(auto-fill,2.25rem)] justify-between" role="listbox" aria-label="Emoji">
            {#each customFound as e, i (e.id)}{@render customCell(e, i)}{/each}
            {#each emojiFound as entry, i (entry.emoji)}{@render emojiCell(entry, customFound.length + i)}{/each}
            {#each animatedFound as entry, i (entry.code)}
              {@const index = customFound.length + emojiFound.length + i}
              <button
                type="button"
                class="{cell} {lit(index)}"
                title={`:${entry.name}:`}
                aria-label={entry.name}
                {...option(index)}
                onclick={() => pick(`noto:${entry.code}`)}
              >
                <IconGlyph icon={`noto:${entry.code}`} size={26} animate={index === selected} />
              </button>
            {/each}
          </div>
        {:else if entries.length}
          <p class="px-1 py-6 text-center text-ink-30">No emoji match</p>
        {/if}
      {:else}
        {#each sections as key (key)}
          <section data-section={key} class="[content-visibility:auto] [contain-intrinsic-size:auto_12rem]">
            <p class="sticky top-0 z-[1] bg-surface px-1 pt-2 pb-1 text-[12px] font-medium text-ink-45">{label(key)}</p>
            <div class="grid grid-cols-[repeat(auto-fill,2.25rem)] justify-between">
              {#if key === "recent"}
                {#each recent as icon (icon)}
                  <button type="button" class={cell} onclick={() => pick(icon)}><IconGlyph {icon} size={24} /></button>
                {/each}
              {:else if key === "custom"}
                {#each emoji.list as e (e.id)}{@render customCell(e, -1)}{/each}
                {#if canAdd}{@render addCell()}{/if}
              {:else}
                {#each byGroup.get(key) ?? [] as entry (entry.emoji)}{@render emojiCell(entry, -1)}{/each}
              {/if}
            </div>
          </section>
        {/each}
      {/if}
    {:else if tab === "animated"}
      {#if animatedFound.length}
        <div bind:this={grid} class="grid grid-cols-[repeat(auto-fill,2.25rem)] justify-between pt-1" role="listbox" aria-label="Animated emoji">
          {#each animatedFound as entry, i (entry.code)}
            <button
              type="button"
              class="{cell} {lit(i)}"
              title={`:${entry.name}:`}
              aria-label={entry.name}
              {...option(i)}
              onclick={() => pick(`noto:${entry.code}`)}
            >
              <IconGlyph icon={`noto:${entry.code}`} size={26} animate={i === selected} />
            </button>
          {/each}
        </div>
      {:else if animated.length}
        <p class="px-1 py-6 text-center text-ink-30">No animated emoji match</p>
      {/if}
    {:else if iconsFound.length}
      {#if iconsOnly && !q && recentIcons.length}
        <p class="px-1 pt-1 text-[12px] text-ink-30">Recent</p>
        <div class="grid grid-cols-[repeat(auto-fill,2.25rem)] justify-between">
          {#each recentIcons as name (name)}
            <button type="button" class="{cell} {iconTone(name)}" title={name} aria-label={name} onclick={() => pick(lucide(name))}>
              <IconGlyph icon={lucide(name)} size={20} />
            </button>
          {/each}
        </div>
        <p class="px-1 pt-2 text-[12px] text-ink-30">All icons</p>
      {/if}
      <div bind:this={grid} class="grid grid-cols-[repeat(auto-fill,2.25rem)] justify-between pt-1" role="listbox" aria-label="Icons">
        {#each iconsFound.slice(0, iconsShown) as entry, i (entry.name)}
          <button type="button" class="{cell} {lit(i)} {iconTone(entry.name)}" title={entry.name} aria-label={entry.name} {...option(i)} onclick={() => pick(lucide(entry.name))}>
            <IconGlyph icon={lucide(entry.name)} size={20} />
          </button>
        {/each}
      </div>
      {#if iconsShown < iconsFound.length}<div bind:this={more} class="h-px"></div>{/if}
    {:else if icons.length}
      <p class="px-1 py-6 text-center text-ink-30">No icons match</p>
    {/if}
  </div>

  {#if tab === "emoji" && !q}
    <div class="flex items-center justify-between border-t border-line px-1 pt-1">
      {#each sections as key (key)}
        {@const Glyph = SECTION_ICONS[key]}
        <button
          type="button"
          class="grid size-7 place-items-center rounded-sm transition-colors hover:bg-ink-5 {active === key ? 'text-ink' : 'text-ink-30'}"
          title={label(key)}
          aria-label={label(key)}
          onclick={() => jumpTo(key)}><Glyph size={16} /></button
        >
      {/each}
    </div>
  {/if}
  {/if}
</div>

{#if adding && workspace.id}
  <AddEmoji workspaceId={workspace.id} onclose={() => (adding = false)} />
{/if}
