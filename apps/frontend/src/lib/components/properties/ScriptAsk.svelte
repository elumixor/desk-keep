<script lang="ts">
  import { SquareMousePointer } from "lucide-svelte";
  import { fade, scale } from "svelte/transition";
  import { pageHref } from "$lib/actions";
  import { scriptAsk } from "$lib/stores/script-ask.svelte";
  import { capitalized } from "$lib/text";
  import { local } from "$lib/sync/local.svelte";
  import PageGlyph from "../ui/PageGlyph.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * What a button's script asks (`scriptAsk`): which button on which page asks, the question, and a field for what it
   * asks for (text, a number, yes or no, a date, or one of its options). Escape or outside dismisses it.
   */
  let text = $state("");
  let checked = $state(false);
  let input = $state<HTMLInputElement>();


  $effect(() => {
    if (!scriptAsk.current) return;
    text = "";
    checked = false;
  });
  $effect(() => {
    const field = input;
    if (field) requestAnimationFrame(() => field.focus());
  });

  /** What is answered: a checkbox as `"true"` or `"false"`; nothing while a number or date is not filled in. */
  const reply = $derived.by(() => {
    const kind = scriptAsk.current?.kind;
    if (kind === "checkbox") return String(checked);
    if ((kind === "number" || kind === "date") && text.trim() === "") return null;
    return text;
  });

  function submit() {
    if (scriptAsk.current && reply !== null) scriptAsk.current.answer(reply);
  }

  function onkey(event: KeyboardEvent) {
    if (!scriptAsk.current || event.isComposing) return;
    if (event.key === "Escape") scriptAsk.current.answer(null);
    else if (event.key === "Enter" && scriptAsk.current.kind !== "options") submit();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<svelte:window onkeydowncapture={onkey} />

{#if scriptAsk.current}
  {@const { question, kind, options, source, answer } = scriptAsk.current}
  {@const page = local.page(source.pageId)}
  <div class="fixed inset-0 z-[60] grid place-items-center bg-[var(--backdrop)] px-4" role="presentation" transition:fade={{ duration: 100 }} onmousedown={(e) => e.target === e.currentTarget && answer(null)}>
    <div class="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-float" role="dialog" aria-label={question} transition:scale={{ start: 0.97, duration: 120 }}>
      <p class="flex min-w-0 items-center gap-1 text-[12px] text-ink-45">
        <SquareMousePointer size={12} class="shrink-0" />
        <span class="truncate">{source.label}</span>
        <span class="shrink-0">on</span>
        <a class="inline-flex min-w-0 items-center gap-1 rounded-xs underline decoration-ink-20 underline-offset-2 hover:text-ink" href={pageHref(source.pageId)}
          ><PageGlyph icon={page?.icon} kind={page?.kind} id={page?.id} size={12} /><span class="truncate">{page?.title || "Untitled"}</span></a
        >
        <span class="shrink-0">asks</span>
      </p>
      <p class="mt-1.5 text-[15px]">{capitalized(question)}</p>
      {#if kind === "options"}
        <div class="mt-3 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {#each options ?? [] as option (option)}
            <button class="menu-item" onclick={() => answer(option)}>{option}</button>
          {/each}
        </div>
      {:else}
        {#if kind === "checkbox"}
          <label class="mt-3 flex items-center gap-2 text-[14px] text-ink-70">
            <input type="checkbox" class="size-4 accent-[var(--accent)]" bind:checked />{checked ? "Yes" : "No"}
          </label>
        {:else}
          <TextField bind:ref={input} bind:value={text} type={kind === "text" ? "text" : kind} class="mt-3 h-8 w-full" />
        {/if}
        <div class="mt-4 flex justify-end gap-2">
          <button class="h-8 rounded-sm px-3 text-ink-70 transition-colors hover:bg-ink-5" onclick={() => answer(null)}>Cancel</button>
          <button class="h-8 rounded-sm bg-accent px-3 font-medium text-page transition-colors hover:bg-accent/90 disabled:opacity-60" disabled={reply === null} onclick={submit}>OK</button>
        </div>
      {/if}
    </div>
  </div>
{/if}
