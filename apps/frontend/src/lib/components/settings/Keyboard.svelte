<script lang="ts">
  import SelectMenu from "../ui/SelectMenu.svelte";
  import { completion } from "$lib/stores/completion.svelte";
  import { vim } from "$lib/stores/vim.svelte";
  import Section from "./Section.svelte";
  import TextField from "../ui/TextField.svelte";

  const SHORTCUTS: [keys: string, what: string][] = [
    ["Esc · i a o", "Normal mode · insert"],
    ["v · V", "Select characters · lines"],
    ["+ · _", "Select a larger · smaller region: word, quotes, brackets, sentence, line, block, page"],
    ["/ ? · n N", "Search the page with Vim patterns · next, previous"],
    ["* #", "Search the word under the cursor"],
    [":%s/a/b/g", "Replace (also :'<,'>s from a selection)"],
    ["Ctrl D · Ctrl U", "Half a page down · up"],
    ["Ctrl O · Ctrl I", "Back · forward between pages"],
    ["Space e", "Find a page"],
    ["Space w", "Switch workspace"],
    ["⌘F", "Show the page in the sidebar"],
    ["⌘N", "Create a page, view or trait, under the open page or any other"],
    ["⇧⌘J · ⇧⌘K", "Move the block, table row or list item down · up (also ⇧⌘↓ ⇧⌘↑)"],
    ["⇧⌘H · ⇧⌘L", "Move the table column left · right (also ⇧⌘← ⇧⌘→)"],
    ["⌘ click · ⇧ click · ⇧ j k", "Select pages in the sidebar, then m moves, d trashes, Esc clears"],
    ["j k · h l · Enter", "Move · close, open · go, in the sidebar"],
  ];
</script>

<Section title="Keyboard" about="Ghost text and Vim keys in the page editor, with Zed's shortcuts around it, on this device.">
  <label class="flex h-8 items-center gap-2.5">
    <input
      type="checkbox"
      class="size-4 accent-[var(--accent)]"
      checked={completion.enabled}
      onchange={() => completion.toggle()}
      data-testid="completion-toggle"
    />
    Completions as you write <span class="text-ink-45">· Tab takes one, Esc drops it</span>
  </label>
  <label class="flex h-8 items-center gap-2.5">
    <input type="checkbox" class="size-4 accent-[var(--accent)]" checked={vim.enabled} onchange={() => vim.toggle()} />
    Vim mode
  </label>
  {#if vim.enabled}
    <label class="flex h-8 items-center gap-2.5">
      <TextField
        type="number"
        min="0"
        max="20"
        class="h-7 w-14 px-2"
        value={vim.scrolloff}
        onchange={(e) => vim.setScrolloff(e.currentTarget.valueAsNumber)}
      />
      Lines kept visible around the cursor
    </label>
    <div class="flex h-8 items-center gap-2.5">
      <SelectMenu class="bg-ink-5" label="Line numbers" value={vim.lineNumbers}
        choices={[{ value: "off", label: "Off" }, { value: "absolute", label: "Absolute" }, { value: "relative", label: "Relative" }]}
        onpick={(v) => vim.setLineNumbers(v)} />
      Line numbers
    </div>
    {#if vim.lineNumbers !== "off"}
      <div class="flex h-8 items-center gap-2.5">
        <SelectMenu class="bg-ink-5" label="Line numbers side" value={vim.numbersSide}
          choices={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]}
          onpick={(v) => vim.setNumbersSide(v)} />
        Line numbers side
      </div>
    {/if}
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {#each SHORTCUTS as [keys, what] (keys)}
        <dt><kbd class="rounded-xs bg-ink-5 px-1.5 py-0.5 font-mono text-[12px] text-ink-70">{keys}</kbd></dt>
        <dd class="text-ink-45">{what}</dd>
      {/each}
    </dl>
  {/if}
</Section>
