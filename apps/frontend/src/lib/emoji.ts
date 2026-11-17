import type { Emoji as EmojibaseEmoji } from "emojibase";
import { EMOJI_IMAGE_MAX, EMOJI_IMAGE_TYPES, ICON_MAX, notoEmoji } from "$model/icons";

/**
 * What the icon picker and `:` choose from, each fetched the first time it is needed: the Unicode emoji (Emojibase's
 * English data, with GitHub's shortcodes, only those this device draws), Google's animated Noto emoji, and the Lucide
 * icons with the words they are found by.
 */
export interface EmojiEntry {
  readonly emoji: string;
  readonly label: string;
  readonly group: EmojiGroup["key"];
  /** GitHub's names for it (`grinning`), which `:` finds it by first. */
  readonly shortcodes: readonly string[];
  readonly tags: readonly string[];
  /** The emoji in each skin tone, lightest first, when it has them. */
  readonly skins: readonly string[] | null;
}

export interface AnimatedEntry {
  /** Google's name for it, the `noto:` icon's value. */
  readonly code: string;
  readonly emoji: string;
  readonly name: string;
  readonly tags: readonly string[];
}

export interface IconEntry {
  readonly name: string;
  readonly tags: readonly string[];
}

/** The picker's sections, in Emojibase's groups (smileys and people are one, as in Notion; skin swatches are none). */
export const EMOJI_GROUPS = [
  { key: "people", label: "People", groups: [0, 1] },
  { key: "nature", label: "Animals & nature", groups: [3] },
  { key: "food", label: "Food & drink", groups: [4] },
  { key: "activities", label: "Activities", groups: [6] },
  { key: "travel", label: "Travel & places", groups: [5] },
  { key: "objects", label: "Objects", groups: [7] },
  { key: "symbols", label: "Symbols", groups: [8] },
  { key: "flags", label: "Flags", groups: [9] },
] as const;
type EmojiGroup = (typeof EMOJI_GROUPS)[number];

const NOTO_INDEX = "https://googlefonts.github.io/noto-emoji-animation/data/api.json";
const LUCIDE_TAGS = "https://cdn.jsdelivr.net/npm/lucide-static@1.0.1/tags.json";
const TONES = ["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"];

let emojiList: Promise<readonly EmojiEntry[]> | null = null;
let animatedList: Promise<readonly AnimatedEntry[]> | null = null;
let iconList: Promise<readonly IconEntry[]> | null = null;
/** Filled once the emoji are loaded, so typing `:smile:` can turn into 😄 without waiting. */
let byShortcode = new Map<string, string>();

export function loadEmoji(): Promise<readonly EmojiEntry[]> {
  emojiList ??= Promise.all([
    import("emojibase-data/en/data.json"),
    import("emojibase-data/en/shortcodes/github.json"),
  ]).then(([{ default: data }, { default: shortcodes }]) => {
    const list = build(data, shortcodes);
    byShortcode = new Map(list.flatMap((e) => e.shortcodes.map((code) => [code, e.emoji] as const)));
    return list;
  });
  return emojiList;
}

export function loadAnimated(): Promise<readonly AnimatedEntry[]> {
  animatedList ??= fetch(NOTO_INDEX)
    .then(
      (response) => response.json() as Promise<{ icons: { codepoint: string; tags: string[]; popularity: number }[] }>,
    )
    .then(({ icons }) =>
      icons.map((icon) => {
        const tags = icon.tags.map((tag) => tag.replace(/^:|:$/g, ""));
        return { code: icon.codepoint, emoji: notoEmoji(icon.codepoint), name: tags[0] ?? icon.codepoint, tags };
      }),
    );
  animatedList.catch(() => (animatedList = null));
  return animatedList;
}

export function loadIcons(): Promise<readonly IconEntry[]> {
  iconList ??= fetch(LUCIDE_TAGS)
    .then((response) => response.json() as Promise<Record<string, string[]>>)
    .then((tags) => Object.entries(tags).map(([name, words]) => ({ name, tags: words })));
  iconList.catch(() => (iconList = null));
  return iconList;
}

/** The emoji a shortcode names, once the emoji are loaded. */
export const shortcodeEmoji = (code: string): string | undefined => byShortcode.get(code);

/** An emoji in the skin tone picked (0 is the yellow default, 1 to 5 the tones), when it comes in tones. */
export const toned = (entry: EmojiEntry, tone: number): string => (tone && entry.skins?.[tone - 1]) || entry.emoji;

/** The raised hand in each tone, which the picker's tone switch shows. */
export const TONE_SAMPLES = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];

function build(data: readonly EmojibaseEmoji[], shortcodes: Record<string, string | string[]>): EmojiEntry[] {
  const drawn = newestDrawn(data);
  const groupOf = new Map<number, EmojiGroup["key"]>(
    EMOJI_GROUPS.flatMap((g) => g.groups.map((n) => [n, g.key] as const)),
  );
  return data
    .filter((e) => e.group !== undefined && groupOf.has(e.group) && (e.version ?? 0) <= drawn)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((e) => {
      const codes = shortcodes[e.hexcode] ?? [];
      return {
        emoji: e.emoji,
        label: e.label,
        group: groupOf.get(e.group as number) as EmojiGroup["key"],
        shortcodes: Array.isArray(codes) ? codes : [codes],
        tags: e.tags ?? [],
        skins: skinsOf(e),
      };
    });
}

/** The five single-tone variants (a couple's 25 mixes are left out), or none. */
function skinsOf(entry: EmojibaseEmoji): string[] | null {
  if (!entry.skins) return null;
  const tones = TONES.map((tone) =>
    entry.skins?.find(
      (s) =>
        s.hexcode
          .split("-")
          .filter((c) => TONES.includes(c))
          .join() === tone,
    ),
  );
  return tones.every(Boolean) ? tones.map((s) => s?.emoji ?? "") : null;
}

/**
 * The newest Emoji version this device draws in colour: its first emoji is drawn twice, in red and in blue, and a
 * glyph the font has keeps its own colours both times where a missing one takes the fill's (as emoji-mart tells).
 */
function newestDrawn(data: readonly EmojibaseEmoji[]): number {
  const firstOf = new Map<number, string>();
  for (const e of data) if (e.version !== undefined && !firstOf.has(e.version)) firstOf.set(e.version, e.emoji);
  const versions = [...firstOf.keys()].sort((a, b) => b - a);
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return versions[0] ?? 0;
  return versions.find((version) => drawsInColour(context, firstOf.get(version) ?? "")) ?? 0;
}

function drawsInColour(context: CanvasRenderingContext2D, emoji: string): boolean {
  const size = 20;
  context.canvas.width = size * 2;
  context.canvas.height = size;
  context.font = `${size - 4}px sans-serif`;
  context.textBaseline = "top";
  context.fillStyle = "#f00";
  context.fillText(emoji, 0, 0);
  context.fillStyle = "#00f";
  context.fillText(emoji, size, 0);
  const left = context.getImageData(0, 0, size, size).data;
  let i = 0;
  while (i < left.length && !left[i + 3]) i += 4;
  if (i >= left.length || context.measureText(emoji).width >= size * 1.5) return false;
  const right = context.getImageData(size + ((i / 4) % size), Math.floor(i / 4 / size), 1, 1).data;
  return left[i] === right[0] && left[i + 2] === right[2];
}

/**
 * How well words match a query, lower is better and `null` none: a name that is the query, then one that starts with
 * it, then a word of the label or a tag that starts with it, then any that contains it.
 */
function rank(query: string, names: readonly string[], words: readonly string[]): number | null {
  const q = query.toLowerCase();
  if (!q) return 0;
  if (names.includes(q)) return 0;
  if (names.some((n) => n.startsWith(q))) return 1;
  if (
    words.some((w) =>
      w
        .toLowerCase()
        .split(/[\s_-]+/)
        .some((part) => part.startsWith(q)),
    )
  )
    return 2;
  if ([...names, ...words].some((w) => w.toLowerCase().includes(q))) return 3;
  return null;
}

/** The entries that match, best first; an entry is found by its names, then by its other words. */
export function search<T>(
  list: readonly T[],
  query: string,
  terms: (entry: T) => { names: readonly string[]; words: readonly string[] },
  limit = Number.POSITIVE_INFINITY,
): T[] {
  if (!query) return list.slice(0, limit);
  const ranked: { entry: T; rank: number; index: number }[] = [];
  list.forEach((entry, index) => {
    const { names, words } = terms(entry);
    const found = rank(query, names, words);
    if (found !== null) ranked.push({ entry, rank: found, index });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.entry);
}

export const emojiTerms = (e: EmojiEntry) => ({ names: e.shortcodes, words: [e.label, ...e.tags] });
export const animatedTerms = (e: AnimatedEntry) => ({ names: e.tags, words: [] });
export const iconTerms = (e: IconEntry) => ({ names: [e.name], words: e.tags });

/** The side an uploaded emoji is shrunk to fit: twice the largest it is drawn, the page icon's. */
const EMOJI_SIZE = 160;

/**
 * An uploaded picture made into what a custom emoji keeps: a data URL, shrunk to `EMOJI_SIZE` as a PNG when it is
 * larger. A GIF keeps its frames and an SVG its sharpness, as they are, when they are small enough.
 */
export async function prepareImage(file: File): Promise<string> {
  if (!(EMOJI_IMAGE_TYPES as readonly string[]).includes(file.type))
    throw new Error("Pick a PNG, WebP, GIF, JPEG or SVG image");
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = original;
  await image.decode().catch(() => {
    throw new Error("This file is not an image that can be shown");
  });
  const { naturalWidth: width, naturalHeight: height } = image;
  const keep = file.type === "image/gif" || file.type === "image/svg+xml" || Math.max(width, height) <= EMOJI_SIZE;
  if (keep && original.length <= EMOJI_IMAGE_MAX) return original;
  if (!width || !height) throw new Error("This image is too large: keep it under 256 kB");
  const scale = Math.min(1, EMOJI_SIZE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const resized = canvas.toDataURL("image/png");
  if (resized.length > EMOJI_IMAGE_MAX) throw new Error("This image is too large: keep it under 256 kB");
  return resized;
}

/** The side an uploaded icon is cropped to and shrunk to: the page icon is drawn at most 40px across, so 2x and then some. */
const ICON_SIZE = 128;

/**
 * A picture made into an icon as it is stored (`image:<data URL>`): cropped to the square its middle fills, shrunk to
 * `ICON_SIZE` and kept as a WebP (a PNG where the browser has none) small enough to travel with every page.
 * A link is fetched first, which its site may refuse.
 */
export async function prepareIcon(source: Blob | string): Promise<string> {
  let blob: Blob;
  if (typeof source === "string") {
    try {
      blob = await (await fetch(source)).blob();
    } catch {
      throw new Error("That link could not be fetched: save the image and upload it instead");
    }
  } else blob = source;
  if (!blob.type.startsWith("image/")) throw new Error("Pick an image");
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error("This file is not an image that can be shown");
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("This file is not an image that can be shown");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(ICON_SIZE, side);
    canvas
      .getContext("2d")
      ?.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    for (const quality of [0.9, 0.8, 0.6, 0.4]) {
      const encoded = canvas.toDataURL("image/webp", quality);
      if (encoded.length + "image:".length <= ICON_MAX) return `image:${encoded}`;
    }
    throw new Error("This image is too detailed to keep as an icon");
  } finally {
    URL.revokeObjectURL(url);
  }
}
