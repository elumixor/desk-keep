<script lang="ts" generics="T extends string">
  import ChoiceList, { type Choice } from "./ChoiceList.svelte";
  import Popover from "./Popover.svelte";

  /**
   * A select as a menu: the trigger shows the chosen label; open, its choices under a search field (ChoiceList).
   */
  let {
    value,
    choices,
    onpick,
    label,
    disabled = false,
    class: extra = "",
  }: {
    value: T;
    choices: readonly Choice<T>[];
    onpick: (value: T) => void;
    label: string;
    disabled?: boolean;
    class?: string;
  } = $props();

  let open = $state(false);
  const current = $derived(choices.find((c) => c.value === value));
</script>

<Popover bind:open width="w-56">
  {#snippet trigger({ toggle })}
    <button type="button" class="flex h-8 items-center truncate rounded-sm px-2 text-left outline-none transition-colors enabled:hover:bg-ink-5 focus-visible:bg-ink-5 {open ? 'bg-ink-5' : ''} {extra}" aria-label={label} aria-expanded={open} {disabled} onclick={toggle}>
      <span class="truncate">{current?.label ?? ""}</span>
    </button>
  {/snippet}
  {#snippet children({ close })}
    <ChoiceList {choices} {label} {value} onpick={(next) => { close(); if (next !== value) onpick(next); }} />
  {/snippet}
</Popover>
