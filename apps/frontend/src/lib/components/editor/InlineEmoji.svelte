<script lang="ts">
  import IconGlyph from "../ui/IconGlyph.svelte";

  /** An emoji node in a line of text, a little larger than the letters around it; an animated one keeps playing. */
  let { icon, fallback }: { icon: string; fallback: string } = $props();
</script>

<span role="img" aria-label={fallback}>
  <IconGlyph {icon} size="1.25em" animate {fallback} />
</span>
