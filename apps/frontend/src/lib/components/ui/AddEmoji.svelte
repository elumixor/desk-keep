<script lang="ts">
  import { fade, scale } from "svelte/transition";
  import { ImageUp } from "lucide-svelte";
  import { EMOJI_NAME_MAX, emojiName } from "$model/icons";
  import { prepareImage } from "$lib/emoji";
  import { emoji } from "$lib/stores/emoji.svelte";
  import TextField from "./TextField.svelte";

  /** The dialog a custom emoji is added in: a picture and the name `:` finds it by. Closes once it is saved. */
  let { workspaceId, onclose }: { workspaceId: string; onclose: () => void } = $props();

  let image = $state<string | null>(null);
  let name = $state("");
  let problem = $state<string | null>(null);
  let saving = $state(false);
  let input = $state<HTMLInputElement>();
  let nameInput = $state<HTMLInputElement>();

  const finalName = $derived(emojiName(name));
  const taken = $derived(!!finalName && !!emoji.byName(finalName));
  const ready = $derived(!!image && !!finalName && !taken && !saving);

  async function choose() {
    const file = input?.files?.[0];
    if (!file) return;
    try {
      image = await prepareImage(file);
      problem = null;
      if (!name) name = emojiName(file.name.replace(/\.[^.]+$/, ""));
      nameInput?.focus();
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      if (input) input.value = "";
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!ready || !image) return;
    saving = true;
    const added = await emoji.add(workspaceId, finalName, image);
    saving = false;
    if (added) onclose();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions — Escape closes only this dialog, not the picker under it. -->
<div
  class="fixed inset-0 z-[60] grid place-items-center bg-[var(--backdrop)] px-4"
  role="presentation"
  transition:fade={{ duration: 100 }}
  onmousedown={(event) => event.target === event.currentTarget && onclose()}
>
  <form
    class="w-full max-w-sm rounded-lg bg-surface p-5 text-[14px] text-ink shadow-float"
    aria-label="Add custom emoji"
    transition:scale={{ start: 0.97, duration: 120 }}
    onsubmit={save}
    {onkeydown}
  >
    <h2 class="text-[16px] font-semibold">Add custom emoji</h2>
    <p class="mt-1 text-ink-45">Custom emoji can be used by anyone in your workspace.</p>
    <div class="mt-4 flex items-center gap-3">
      <div class="grid size-14 shrink-0 place-items-center rounded-md bg-ink-5">
        {#if image}<img src={image} alt="" class="size-10 object-contain" />{:else}<ImageUp size={20} class="text-ink-30" />{/if}
      </div>
      <button type="button" class="h-8 rounded-sm px-3 shadow-panel transition-colors hover:bg-ink-5" onclick={() => input?.click()}>
        {image ? "Change image" : "Upload an image"}
      </button>
      <input bind:this={input} type="file" accept="image/png,image/webp,image/gif,image/jpeg,image/svg+xml" class="hidden" onchange={choose} />
    </div>
    <label class="mt-4 block">
      <span class="text-[12px] font-medium text-ink-45">Emoji name</span>
      <TextField
        bind:ref={nameInput}
        bind:value={name}
        maxlength={EMOJI_NAME_MAX}
        class="mt-1 w-full"
        placeholder="have-fun-with-it"
        aria-label="Emoji name"
      />
    </label>
    <p class="mt-1.5 min-h-[18px] text-[12px] {problem || taken ? 'text-hot' : 'text-ink-30'}">
      {#if problem}{problem}{:else if taken}There is a :{finalName}: already{:else if finalName}Type :{finalName}: to use it{/if}
    </p>
    <div class="mt-3 flex justify-end gap-2">
      <button type="button" class="h-8 rounded-sm px-3 text-ink-70 transition-colors hover:bg-ink-5" onclick={onclose}>Cancel</button>
      <button type="submit" class="h-8 rounded-sm bg-accent px-3 font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50" disabled={!ready}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </form>
</div>
