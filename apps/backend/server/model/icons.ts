import { UUID } from "./urn";

/**
 * What a page's (or a trait's) icon is, and what an emoji in a body points at, as the one string it is stored as:
 * an emoji as itself, a Lucide icon (`lucide:<name>`, or `lucide:<name>:<color>` tinted), one of Google's animated
 * Noto emoji (`noto:<codepoint>`, the codepoints joined by `_` as Google names them), or one of the workspace's own
 * (`custom:<id>`), or a picture someone uploaded (`image:<data URL>`). Anything else that is not empty is taken for an emoji, as icons always were.
 */
export type Icon =
  | { readonly kind: "emoji"; readonly emoji: string }
  | { readonly kind: "lucide"; readonly name: string; readonly color: IconColor | null }
  | { readonly kind: "noto"; readonly code: string }
  | { readonly kind: "custom"; readonly id: string }
  | { readonly kind: "image"; readonly src: string };

/** The colours a Lucide icon can be tinted, the same names a select's options use. */
export const ICON_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type IconColor = (typeof ICON_COLORS)[number];

const LUCIDE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NOTO_CODE = /^[0-9a-f]{2,6}(_[0-9a-f]{2,6})*$/;

/** The longest an icon may be as stored: an uploaded picture is kept in it as a data URL (a 256px one is a few kB). */
export const ICON_MAX = 24_000;
const IMAGE_ICON = /^image:(data:image\/(?:png|webp|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/]+=*)$/;

export function parseIcon(value: string | null | undefined): Icon | null {
  if (!value) return null;
  const image = IMAGE_ICON.exec(value)?.[1];
  if (image) return { kind: "image", src: image };
  const [prefix, rest = "", extra] = value.split(":");
  if (prefix === "lucide" && LUCIDE_NAME.test(rest)) {
    const color = ICON_COLORS.find((c) => c === extra) ?? null;
    return { kind: "lucide", name: rest, color };
  }
  if (prefix === "noto" && NOTO_CODE.test(rest)) return { kind: "noto", code: rest };
  if (prefix === "custom" && UUID.test(rest)) return { kind: "custom", id: rest.toLowerCase() };
  return { kind: "emoji", emoji: value };
}

export function formatIcon(icon: Icon): string {
  switch (icon.kind) {
    case "emoji":
      return icon.emoji;
    case "lucide":
      return icon.color ? `lucide:${icon.name}:${icon.color}` : `lucide:${icon.name}`;
    case "noto":
      return `noto:${icon.code}`;
    case "custom":
      return `custom:${icon.id}`;
    case "image":
      return `image:${icon.src}`;
  }
}

/** The emoji a Noto codepoint stands for: `263a_fe0f` is ☺️. */
export const notoEmoji = (code: string) =>
  String.fromCodePoint(...code.split("_").map((part) => Number.parseInt(part, 16)));

const NOTO = "https://fonts.gstatic.com/s/e/notoemoji/latest";
export const notoStill = (code: string) => `${NOTO}/${code}/emoji.svg`;
export const notoAnimation = (code: string) => `${NOTO}/${code}/lottie.json`;

/**
 * The text an icon stands for where only text goes (a Markdown export, the search index, a tab's title): an emoji is
 * itself, an animated one the emoji it animates, a custom one its `:name:` when the name is known; a Lucide icon has none.
 */
export function iconText(value: string | null | undefined, name?: string | null): string {
  const icon = parseIcon(value);
  if (!icon) return "";
  if (icon.kind === "emoji") return icon.emoji;
  if (icon.kind === "noto") return notoEmoji(icon.code);
  if (icon.kind === "custom") return name ? `:${name}:` : "";
  return "";
}

/** A custom emoji's name: what `:` finds it by, lower case, words joined by `-` or `_`. */
export const EMOJI_NAME = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
export const EMOJI_NAME_MAX = 40;

/** What someone typed as a name, made into one: `Have fun!` is `have-fun`. */
export const emojiName = (typed: string) =>
  typed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/([_-])[_-]+/g, "$1")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, EMOJI_NAME_MAX)
    .replace(/[_-]+$/, "");

/** An uploaded emoji is kept as a data URL of one of these, at most this long: 256 kB of picture (a 128px one is a few kB). */
export const EMOJI_IMAGE_TYPES = ["image/png", "image/webp", "image/gif", "image/jpeg", "image/svg+xml"] as const;
export const EMOJI_IMAGE_MAX = 350_000;

/**
 * The inline node an animated or custom emoji is in a body (a plain emoji is just text): `icon` is what it shows,
 * `name` what it was found by, which a custom one is written as.
 */
export const EMOJI_NODE = "emoji";

export const emojiNodeText = (attrs: Readonly<Record<string, unknown>> | undefined) =>
  iconText(typeof attrs?.icon === "string" ? attrs.icon : null, typeof attrs?.name === "string" ? attrs.name : null);
