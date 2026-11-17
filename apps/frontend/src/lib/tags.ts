/** Option colours, by name; each is a `--tag-*` token from @desk/core, so palettes and dark mode follow. */
export const TAG_COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink", "brown"] as const;
type TagColor = (typeof TAG_COLORS)[number];

const known = (color: string | null | undefined): TagColor =>
  TAG_COLORS.includes(color as TagColor) ? (color as TagColor) : "gray";

export const tagStyle = (color: string | null | undefined) =>
  `background: var(--tag-${known(color)}); color: var(--tag-ink)`;

/** A board column's wash: the option's colour, fainter than its tag. */
export const columnStyle = (color: string | null | undefined) =>
  `background: color-mix(in srgb, var(--tag-${known(color)}) 45%, transparent)`;

/** How a tag sits: a soft, fully rounded pill. */
export const TAG =
  "inline-flex h-5 max-w-full items-center truncate rounded-full px-2 text-[12px] leading-none whitespace-nowrap";
