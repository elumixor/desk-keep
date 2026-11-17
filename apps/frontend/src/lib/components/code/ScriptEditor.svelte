<script lang="ts">
  import { LoaderCircle, Play } from "lucide-svelte";
  import { fade, scale, slide } from "svelte/transition";
  import { confirm } from "$lib/stores/confirm.svelte";
  import type { Schema } from "$model/properties";
  import type { ScriptTerm } from "$model/script/terms";
  import type { ScriptSelect } from "$model/script/types";
  import AssistantBar from "./AssistantBar.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import type { Problem } from "./problems";
  import TermsPanel from "./TermsPanel.svelte";
  import type { FormulaValue } from "$model/properties";
  import { PROPERTY_ICONS, propertyTypeLabel } from "$lib/property-icons";
  import ValueView from "../properties/ValueView.svelte";

  /** What running gave: a script's logs and what it threw; a formula's value too (`result`, null when empty). */
  interface RunOutput {
    readonly logs: readonly string[];
    readonly error?: string;
    readonly result?: FormulaValue | null;
  }

  /**
   * A script's editor over everything (a button's now, a formula's next): the assistant's bar, the code, what running
   * it gave, and what it can use. `onrun`, when given, runs the code here and answers what it logged and threw. Save
   * (or ⌘Enter) is `ondone`, which saves and closes; ⌘S is `onsave`, which keeps it open; Cancel is `oncancel`, which keeps nothing; Escape or a click outside asks first when something is unsaved.
   */
  let {
    title,
    code = $bindable(""),
    declarations,
    schema,
    selects,
    language = "script",
    terms,
    placeholder,
    edited,
    onrun,
    onsave,
    ondone,
    oncancel,
  }: {
    title: string;
    code?: string;
    declarations: string;
    schema: Schema;
    selects: readonly ScriptSelect[];
    /** A button's script or a formula. */
    language?: "script" | "formula";
    terms: readonly ScriptTerm[];
    placeholder: string;
    /** Whether the code differs from what is saved: only then are Cancel and Save offered (closing keeps nothing to lose). */
    edited: boolean;
    onrun?: () => Promise<RunOutput | null>;
    onsave: () => void;
    ondone: () => void;
    oncancel: () => void;
  } = $props();

  let editor = $state<CodeEditor>();
  let problems = $state<readonly Problem[]>([]);
  /** Errors stop a run; warnings (a formula that returns nothing) do not, and neither stops a save. */
  const errors = $derived(problems.filter((p) => !p.warning));
  let running = $state(false);
  let output = $state<RunOutput | null>(null);
  const resultIcon = $derived(output?.result ? PROPERTY_ICONS[output.result.type] : null);

  // A formula runs as it is typed: what it is shows under it.
  const RERUN_DELAY_MS = 300;
  $effect(() => {
    if (language !== "formula" || !onrun) return;
    void code;
    const timer = setTimeout(() => void run(), RERUN_DELAY_MS);
    return () => clearTimeout(timer);
  });

  async function run() {
    if (!onrun) return;
    running = true;
    output = await onrun();
    running = false;
  }

  // Seen before the editor's own handling: an Escape closing one of its popups is left to it.
  function onescape(event: KeyboardEvent) {
    if (event.key === "Escape" && !editor?.takesEscape()) {
      event.preventDefault();
      dismiss();
    }
  }

  /** Closes, asking first when something is unsaved. */
  function dismiss() {
    if (edited) confirm.show("Discard the unsaved changes?", "Discard", oncancel, true);
    else oncancel();
  }

  /** Vim's `:q`: closes unless something is unsaved, `:q!` anyway. */
  function onquit(force: boolean) {
    if (edited && !force) return false;
    oncancel();
    return true;
  }

  function onkey(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey) || event.defaultPrevented) return;
    if (event.key === "Enter") ondone();
    else if (event.key === "s") onsave();
    else return;
    event.preventDefault();
  }
</script>

<div class="fixed inset-0 z-50 bg-[var(--backdrop)] px-4" role="presentation" transition:fade={{ duration: 100 }} onmousedown={(e) => e.target === e.currentTarget && dismiss()}>
  <div class="mx-auto mt-[10vh] flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-float" role="dialog" aria-label={title} transition:scale={{ start: 0.97, duration: 120 }} tabindex="-1" onkeydowncapture={onescape} onkeydown={onkey}>
    <div class="space-y-2 overflow-y-auto px-4 pt-4 pb-3">
      <CodeEditor bind:this={editor} bind:value={code} {declarations} {schema} {selects} {language} {placeholder} {onsave} onsubmit={ondone} {onquit} maxHeight={420} onproblems={(found) => (problems = found)}
        class="rounded-sm bg-[var(--code-bg)] ring-1 ring-ink-10 focus-within:ring-accent" />
      {#if problems.length}
        <!-- Five shown, the rest scrolled to; each goes to where it is. -->
        <ul class="max-h-[8.75rem] overflow-y-auto text-[12px]">
          {#each problems as problem, index (index)}
            <li>
              <button class="flex h-7 w-full items-center gap-2 rounded-sm px-1.5 text-left transition-colors hover:bg-ink-5 {problem.warning ? 'text-[var(--warn)]' : 'text-hot'}"
                onclick={() => editor?.goTo(problem.line, problem.column)}>
                <span class="grid h-5 min-w-6 shrink-0 place-items-center rounded-xs bg-ink-5 px-1 font-mono text-[11px] text-ink-45">{problem.line}</span>
                <span class="min-w-0 truncate">{problem.message}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if language !== "formula"}
      <div class="flex min-h-11 items-start gap-3 border-t border-line px-4 py-2.5 text-[13px]">
        {#if onrun}
          <button class="flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-ink-70 transition-colors hover:bg-ink-5 disabled:opacity-60" disabled={running || errors.length > 0} title={errors.length ? "Fix the problems first" : undefined} onclick={run}>
            {#if running}<LoaderCircle size={14} class="animate-spin" />{:else}<Play size={14} />{/if} Run on this page
          </button>
        {/if}
        <div class="min-w-0 flex-1 py-1 font-mono text-[12px]">
          {#if output && (output.logs.length || output.error)}
            <div class="max-h-24 overflow-y-auto whitespace-pre-wrap">{#each output.logs as line}<span class="block text-ink-70">{line}</span>{/each}{#if output.error}<span class="block text-hot">{output.error}</span>{/if}</div>
          {:else}
            <span class="font-sans text-ink-30">{output ? "Ran, nothing logged" : "No output"}</span>
          {/if}
        </div>
      </div>
    {:else if output?.result && resultIcon}
      <!-- A formula's value on this page, with the type it is drawn as; folded away while it has none. -->
      {@const Icon = resultIcon}
      <div class="flex min-h-11 items-center gap-2 border-t border-line px-4 py-2 text-[14px]" transition:slide={{ duration: 150 }}>
        {#key output.result.type}
          <span class="flex h-6 shrink-0 items-center gap-1 rounded-sm bg-ink-5 px-1.5 text-[12px] text-ink-45" in:fade={{ duration: 150 }}><Icon size={13} />{propertyTypeLabel(output.result.type)}</span>
        {/key}
        {#key JSON.stringify(output.result)}
          <span class="flex min-w-0" in:fade={{ duration: 150 }}><ValueView definition={{ type: output.result.type }} value={output.result.value} /></span>
        {/key}
      </div>
    {/if}
    <TermsPanel {terms} oninsert={(text) => editor?.insert(text)} />
    <div class="flex items-center gap-2 border-t border-line px-4 py-3">
      <div class="min-w-0 flex-1"><AssistantBar problems={problems.map((p) => p.message)} /></div>
      {#if edited}
        <button class="h-8 rounded-sm px-3 text-ink-70 transition-colors hover:bg-ink-5" transition:fade={{ duration: 100 }} onclick={oncancel}>Cancel</button>
        <button class="h-8 rounded-sm bg-accent px-3 font-medium text-page transition-colors hover:bg-accent/90" transition:fade={{ duration: 100 }} onclick={ondone}>Save</button>
      {/if}
    </div>
  </div>
</div>
