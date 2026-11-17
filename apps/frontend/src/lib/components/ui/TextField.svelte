<script lang="ts">
  import { untrack } from "svelte";
  import type { HTMLInputAttributes, HTMLTextareaAttributes } from "svelte/elements";

  /**
   * The one text field (app.css `.field`): `filled` a box of its own, `ghost` text that shows it can be typed into when
   * pointed at or focused, `bare` the text alone inside something drawn as the field. `multiline` makes it a textarea.
   * A one-line ghost reached from the keyboard is only selected, as a cell is: Enter edits it, and Enter or Escape
   * while editing selects it again. A click edits it at once. What is typed is kept here: a new `value` from outside (a
   * record replaced by sync) is taken only while the field is not focused, so it never overwrites an edit in progress.
   */
  let {
    value = $bindable(),
    ref = $bindable(),
    variant = "filled",
    multiline = false,
    rows,
    readonly,
    class: extra = "",
    onpointerdown,
    onfocus,
    onblur,
    onkeydown,
    ...rest
  }: HTMLInputAttributes & {
    /** A textarea's height in lines. */
    rows?: number;
    ref?: HTMLInputElement;
    variant?: "filled" | "ghost" | "bare";
    multiline?: boolean;
  } = $props();

  const classes = $derived(`field field-${variant} ${extra}`);
  const cell = $derived(variant === "ghost" && !readonly);
  let pointed = false;
  let focused = $state(false);
  let editing = $state(false);
  const idle = $derived(cell && focused && !editing);
  let text = $state(value);
  $effect.pre(() => {
    const next = value;
    if (!untrack(() => focused)) text = next;
  });
  const typed = {
    get: () => text,
    set: (next: typeof value) => {
      text = next;
      value = next;
    },
  };

  function edit(input: HTMLInputElement) {
    editing = true;
    const end = input.value.length;
    // Not every type has a caret to place (number, date).
    try {
      input.setSelectionRange(end, end);
    } catch {}
  }
</script>

{#if multiline}
  <textarea bind:value={typed.get, typed.set} class={classes} {rows} {...{ readonly, onpointerdown, onkeydown, ...rest } as HTMLTextareaAttributes}
    onfocus={(e) => {
      focused = true;
      (onfocus as ((e: FocusEvent) => void) | undefined)?.(e);
    }}
    onblur={(e) => {
      focused = false;
      (onblur as ((e: FocusEvent) => void) | undefined)?.(e);
    }}
  ></textarea>
{:else}
  <input
    bind:this={ref}
    bind:value={typed.get, typed.set}
    class={classes}
    readonly={readonly || idle}
    data-idle={idle ? "" : undefined}
    onpointerdown={(e) => {
      pointed = true;
      if (focused && cell) edit(e.currentTarget);
      onpointerdown?.(e);
    }}
    onfocus={(e) => {
      focused = true;
      editing = pointed;
      pointed = false;
      onfocus?.(e);
    }}
    onblur={(e) => {
      focused = editing = false;
      onblur?.(e);
    }}
    onkeydown={(e) => {
      if (cell && e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        if (!editing) return edit(e.currentTarget);
        editing = false;
      } else if (cell && editing && e.key === "Escape") editing = false;
      onkeydown?.(e);
    }}
    {...rest}
  />
{/if}
