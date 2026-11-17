<script lang="ts">
  import { untrack } from "svelte";
  import { Type } from "lucide-svelte";
  import type { NodeKind } from "$model/nodes";
  import KindPill from "../ui/KindPill.svelte";
  import TextField from "../ui/TextField.svelte";

  /** What `space r` shows on a mentioned page: its name, kept on Enter. */
  let { initial, kind, onapply }: { initial: string; kind: NodeKind; onapply: (title: string) => void } = $props();

  let title = $state(untrack(() => initial));
  let input = $state<HTMLInputElement>();

  $effect(() => {
    input?.focus();
    input?.select();
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onapply(title.trim());
  }
</script>

<label class="flex h-9 items-center gap-2.5 rounded-md bg-ink-5 px-2.5">
  <Type size={16} class="shrink-0 text-ink-45" />
  <TextField variant="bare"
    bind:ref={input}
    bind:value={title}
    {onkeydown}
    class="flex-1"
    placeholder="Untitled"
    aria-label="Page name"
  />
  <KindPill {kind} />
</label>
