<script lang="ts">
  import { Maximize2, X } from "lucide-svelte";
  import { fly } from "svelte/transition";
  import { pageHref } from "$lib/actions";
  import { portal } from "$lib/portal";
  import PageView from "../page/PageView.svelte";

  let { id, onclose }: { id: string; onclose: () => void } = $props();

  let bar = $state<HTMLElement>();

  /** The page shown when a press began on the page behind: only set while a click there may close the peek. */
  let pressedOn: string | null = null;
  function press(event: PointerEvent) {
    const outside = event.target instanceof Element && event.target.closest("[data-shell]");
    const floating = document.querySelector("[data-popover]");
    pressedOn = outside && !floating ? id : null;
  }
  /** After the click's own handlers: one that opened another page in the peek keeps it open. */
  function click() {
    const pressed = pressedOn;
    pressedOn = null;
    if (pressed) setTimeout(() => pressed === id && onclose());
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} onpointerdowncapture={press} onclickcapture={click} />

<!-- On the body: inside a page's container a fixed box is placed by that container, not the window. -->
<aside
  use:portal
  transition:fly={{ x: 40, duration: 160 }}
  class="fixed inset-y-2 right-2 z-30 flex w-[calc(100%-1rem)] max-w-3xl flex-col overflow-hidden rounded-lg bg-page shadow-float"
  aria-label="Row"
  data-testid="peek"
>
  <div class="flex h-11 items-center gap-1 px-3">
    <a class="grid size-7 place-items-center rounded-sm text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink" href={pageHref(id)} aria-label="Open as full page"><Maximize2 size={16} /></a>
    <div class="ml-auto [&>*]:m-0" bind:this={bar}></div>
    <button class="grid size-7 place-items-center rounded-sm text-ink-45 transition-colors hover:bg-ink-5 hover:text-ink" aria-label="Close" onclick={onclose}><X size={16} /></button>
  </div>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    {#key id}<PageView {id} embedded menuIn={bar} focusTitle />{/key}
  </div>
</aside>
