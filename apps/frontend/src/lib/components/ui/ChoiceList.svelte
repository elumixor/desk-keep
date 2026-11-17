<script lang="ts" module>
  import type { Hash } from "lucide-svelte";
  import type { NodeKind } from "$model/nodes";

  export interface Choice<V extends string = string> {
    readonly value: V;
    readonly label: string;
    readonly icon?: typeof Hash;
    /** An icon an extension names (NamedIcon), when there is no `icon`. */
    readonly named?: string;
    /** A page it stands for, drawn with the page's glyph (PageGlyph) when there is no `icon`. */
    readonly page?: { readonly icon?: string | null; readonly kind?: NodeKind };
    /** Faint text after the label, such as where the page lives. */
    readonly hint?: string;
    /** A heading the choice is listed under, shown above the first of its group. */
    readonly group?: string;
  }
</script>

<script lang="ts" generics="T extends string">
  import { Check } from "lucide-svelte";
  import { menuKey } from "$lib/menu-key";
  import NamedIcon from "./NamedIcon.svelte";
  import PageGlyph from "./PageGlyph.svelte";
  import TextField from "./TextField.svelte";

  /**
   * A menu's choices under a search field (focused when shown) that narrows them, picked with the arrows (or
   * Ctrl+J / Ctrl+K) and Enter, or a click. `value` is the chosen one, checked and first active; `selected`, several checked.
   */
  let {
    choices,
    onpick,
    label,
    value,
    selected,
  }: { choices: readonly Choice<T>[]; onpick: (value: T) => void; label: string; value?: T; selected?: readonly T[] } = $props();

  let query = $state("");
  let input = $state<HTMLInputElement>();
  // Focused once the popup has placed itself, so the field is typed into at once.
  $effect(() => {
    const field = input;
    if (!field) return;
    const frame = requestAnimationFrame(() => field.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  });
  let active = $state(0);
  const shown = $derived(choices.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase())));
  $effect.pre(() => {
    active = Math.max(0, choices.findIndex((c) => c.value === value));
  });

  function onkey(event: KeyboardEvent) {
    const key = menuKey(event);
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const n = shown.length;
      if (n) active = (active + (key === "ArrowDown" ? 1 : -1) + n) % n;
    } else if (key === "Enter") {
      event.preventDefault();
      const choice = shown[active];
      if (choice) onpick(choice.value);
    }
  }
</script>

<TextField bind:ref={input} class="mb-1 w-full" placeholder="Search…" aria-label={label}
  bind:value={query} oninput={() => (active = 0)} onkeydown={onkey} />
{#each shown as choice, index (choice.value)}
  {@const Icon = choice.icon}
  {#if choice.group && choice.group !== shown[index - 1]?.group}
    <p class="px-2 pt-2.5 pb-1.5 text-[12px] font-medium text-ink-45">{choice.group}</p>
  {/if}
  <button type="button" class="menu-item [&>svg]:text-ink-45" data-active={index === active ? "true" : undefined}
    onmouseenter={() => (active = index)} onclick={() => onpick(choice.value)}>
    {#if Icon}<Icon size={16} />{:else if choice.named}<span class="grid size-4 place-items-center text-ink-45"><NamedIcon icon={choice.named} /></span>{:else if choice.page}<PageGlyph icon={choice.page.icon} kind={choice.page.kind} />{/if}
    {#if choice.hint}<span class="min-w-0 truncate">{choice.label}</span><span class="min-w-0 flex-1 truncate text-[13px] text-ink-30">— {choice.hint}</span>
    {:else}<span class="flex-1 truncate">{choice.label}</span>{/if}
    {#if (value !== undefined && choice.value === value) || selected?.includes(choice.value)}<Check size={16} />{/if}
  </button>
{:else}
  <p class="px-2.5 py-1.5 text-ink-30">No matches</p>
{/each}
