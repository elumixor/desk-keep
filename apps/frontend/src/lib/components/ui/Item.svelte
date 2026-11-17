<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  /**
   * A clickable item (app.css `.item`): a link with `href`, else a button; `plain`, a label in the same place.
   * `normal` is a property row, `small` a link under a title; `fixed` fills its column, `hug` fits what it holds.
   * `edge` puts its icon on the text's edge, its padding hanging out to the left.
   */
  let {
    children,
    href,
    size = "normal",
    width = "hug",
    selected = false,
    plain = false,
    edge = false,
    disabled,
    type = "button",
    class: extra = "",
    ...rest
  }: HTMLAttributes<HTMLElement> & {
    children: Snippet;
    href?: string;
    size?: "normal" | "small";
    width?: "fixed" | "hug";
    selected?: boolean;
    plain?: boolean;
    edge?: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
  } = $props();

  const tag = $derived(href ? "a" : plain ? "span" : "button");
</script>

<svelte:element
  this={tag}
  class="item item-{size} item-{width} {edge ? 'item-edge' : ''} {extra}"
  data-selected={selected ? "true" : undefined}
  href={tag === "a" ? href : undefined}
  type={tag === "button" ? type : undefined}
  disabled={tag === "button" ? disabled : undefined}
  {...rest}
>
  {@render children()}
</svelte:element>
