<script lang="ts">
  import { ArrowUp, Sparkles } from "lucide-svelte";
  import { notices } from "$lib/stores/notices.svelte";
  import TextField from "../ui/TextField.svelte";

  /**
   * Where the assistant will be asked to write, fix or explain the code (seeing the page, the code and its
   * `problems`). Not built yet: asking says so.
   */
  let { problems }: { problems: readonly string[] } = $props();
  let ask = $state("");

  function send() {
    if (!ask.trim()) return;
    notices.show("The assistant is coming soon");
    ask = "";
  }
</script>

<div class="flex h-8 items-center gap-2 rounded-lg border border-line pr-0.5 pl-2">
  <Sparkles size={16} class="shrink-0 text-accent" />
  <TextField variant="bare" class="h-7 min-w-0 flex-1" bind:value={ask}
    placeholder={problems.length ? `Fix ${problems.length === 1 ? "the problem" : `${problems.length} problems`}, or write or explain the code…` : "Write, fix, or explain the code…"}
    onkeydown={(e) => e.key === "Enter" && send()} />
  <button class="grid size-6 shrink-0 place-items-center rounded-full bg-ink-10 text-ink-45 transition-colors enabled:hover:bg-accent enabled:hover:text-page disabled:opacity-50"
    aria-label="Ask" disabled={!ask.trim()} onclick={send}><ArrowUp size={14} /></button>
</div>
