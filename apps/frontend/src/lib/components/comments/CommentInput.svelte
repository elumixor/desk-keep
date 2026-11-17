<script lang="ts">
  import { ArrowUp, Check } from "lucide-svelte";
  import CommentField from "./CommentField.svelte";

  /** A comment being written: Enter sends it, Shift+Enter starts a new line, Escape gives up on it; `@` mentions. */
  let {
    value = $bindable(""),
    pageId,
    label,
    placeholder,
    editing = false,
    onsubmit,
    oncancel,
  }: {
    value?: string;
    /** The page it is on: who `@` names is checked against it. */
    pageId: string;
    label: string;
    placeholder?: string;
    /** Rewriting a comment rather than adding one: the box takes focus, and its button saves. */
    editing?: boolean;
    onsubmit: (body: string) => void;
    oncancel?: () => void;
  } = $props();

  let field = $state<ReturnType<typeof CommentField>>();
  const blank = $derived(!value.trim());

  export function focus() {
    field?.focus();
  }

  function submit() {
    if (!blank) onsubmit(value.trim());
  }
</script>

<div class="flex min-w-0 flex-1 items-end gap-1 rounded-md transition-shadow focus-within:shadow-panel {editing ? 'shadow-panel' : ''}">
  <CommentField bind:this={field} bind:value {pageId} {label} {placeholder} autofocus={editing} onenter={submit} onescape={oncancel} />
  <button
    class="mr-1 mb-1 grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:bg-ink-10 disabled:text-ink-30"
    aria-label={editing ? "Save comment" : "Send comment"}
    disabled={blank}
    onclick={submit}
  >
    {#if editing}<Check size={14} />{:else}<ArrowUp size={14} />{/if}
  </button>
</div>
