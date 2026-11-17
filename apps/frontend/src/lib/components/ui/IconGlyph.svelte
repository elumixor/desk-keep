<script lang="ts">
  import type { AnimationItem } from "lottie-web";
  import { notoAnimation, notoStill, parseIcon } from "$model/icons";
  import { emoji } from "$lib/stores/emoji.svelte";

  /**
   * An icon as it is stored (see `$model/icons`), drawn `size` across (pixels, or any CSS length): an emoji as text, a
   * Lucide icon as a mask in its colour (or the text's), an animated emoji as Google's still, looping while `animate` is
   * on, motion is welcome and it is on screen, a custom emoji as its picture, an uploaded picture as a rounded square filling its box. A custom one the workspace no longer has draws `fallback`.
   */
  let {
    icon,
    size = 16,
    animate = false,
    fallback = "",
    class: className = "",
  }: {
    icon: string | null | undefined;
    size?: number | string;
    animate?: boolean;
    fallback?: string;
    class?: string;
  } = $props();

  const LUCIDE = "https://cdn.jsdelivr.net/npm/lucide-static@1.0.1/icons";
  /** An emoji's glyph is drawn a little smaller than its box, as fonts leave no room around it. */
  const GLYPH = 0.85;

  const parsed = $derived(parseIcon(icon));
  /** A primitive, so an unchanged icon read through a fresh page object does not restart its animation. */
  const notoCode = $derived(parsed?.kind === "noto" ? parsed.code : null);
  const box = $derived(typeof size === "number" ? `${size}px` : size);
  const custom = $derived(parsed?.kind === "custom" ? emoji.get(parsed.id) : undefined);

  let frame = $state<HTMLSpanElement>();
  let player = $state<HTMLSpanElement>();
  let playing = $state(false);
  let shown = $state(false);
  let animation = $state.raw<AnimationItem | null>(null);

  $effect(() => {
    const code = notoCode;
    const host = player;
    playing = false;
    if (!code || !host || !animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let loaded: AnimationItem | null = null;
    let gone = false;
    void import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (gone) return;
      loaded = lottie.loadAnimation({ container: host, renderer: "svg", loop: true, autoplay: false, path: notoAnimation(code) });
      loaded.addEventListener("DOMLoaded", () => (playing = true));
      animation = loaded;
    });
    return () => {
      gone = true;
      loaded?.destroy();
      animation = null;
    };
  });

  // An animation off screen stands still, so a page of them costs only what is in view.
  $effect(() => {
    if (!frame || !animate) return;
    const observer = new IntersectionObserver(([entry]) => (shown = !!entry?.isIntersecting));
    observer.observe(frame);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (shown) animation?.play();
    else animation?.pause();
  });
</script>

{#if parsed?.kind === "emoji"}
  <span
    class="inline-grid shrink-0 place-items-center leading-none {className}"
    style:width={box}
    style:height={box}
    style:font-size="calc({box} * {GLYPH})">{parsed.emoji}</span
  >
{:else if parsed?.kind === "lucide"}
  <span
    aria-hidden="true"
    class="inline-block shrink-0 {className}"
    style:width={box}
    style:height={box}
    style="mask: url({LUCIDE}/{parsed.name}.svg) center / contain no-repeat; -webkit-mask: url({LUCIDE}/{parsed.name}.svg) center / contain no-repeat"
    style:background-color={parsed.color ? `var(--hue-${parsed.color})` : "currentColor"}
  ></span>
{:else if parsed?.kind === "noto"}
  <span bind:this={frame} class="relative inline-block shrink-0 {className}" style:width={box} style:height={box}>
    {#if !playing}<img src={notoStill(parsed.code)} alt="" class="absolute inset-0 size-full" loading="lazy" draggable="false" />{/if}
    {#if animate}<span bind:this={player} class="absolute inset-0 size-full"></span>{/if}
  </span>
{:else if parsed?.kind === "image"}
  <img src={parsed.src} alt="" class="inline-block shrink-0 rounded-[0.18em] object-cover {className}" style:width={box} style:height={box} draggable="false" />
{:else if parsed?.kind === "custom"}
  {#if custom}
    <img src={custom.image} alt={`:${custom.name}:`} title={`:${custom.name}:`} class="inline-block shrink-0 object-contain {className}" style:width={box} style:height={box} draggable="false" />
  {:else if fallback}
    <span class={className}>{fallback}</span>
  {/if}
{/if}
