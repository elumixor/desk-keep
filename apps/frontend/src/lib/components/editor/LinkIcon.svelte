<script lang="ts">
  import { ArrowUpRight, Globe, Link, Mail } from "lucide-svelte";
  import { favicon } from "$model/link";

  /** A link's icon, as a mention draws a page's: the site's favicon with the link arrow in the corner. */
  let { href }: { href: string } = $props();

  const url = $derived(favicon(href));
  /** The favicon once loaded: the service answers a site without one with a 16px globe, which is not worth showing. */
  let src = $state<string | null>(null);

  // A background, not an `<img>`: the editor would read one in a link back as an image node.
  $effect(() => {
    src = null;
    if (!url) return;
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 16) src = url;
    };
    image.src = url;
  });
</script>

<span class="mention-icon">
  {#if src}
    <span class="link-favicon" style:background-image={`url("${src}")`}></span>
  {:else if href.startsWith("mailto:")}<Mail size="1.1em" />
  {:else if url}<Globe size="1.1em" />
  {:else}<Link size="1.1em" />{/if}
  <span class="mention-arrow"><ArrowUpRight class="halo" size="0.7em" strokeWidth={12} /><ArrowUpRight size="0.7em" strokeWidth={4.5} /></span>
</span>
