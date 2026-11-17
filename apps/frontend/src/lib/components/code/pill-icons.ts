import { emoji } from "$lib/stores/emoji.svelte";
import { notoStill, parseIcon } from "$model/icons";

/**
 * A page's icon in front of its pill in a script's editor. Monaco draws text only, so each icon is a class whose
 * `::before` draws it, written once into a style sheet of its own.
 */

const LUCIDE = "https://cdn.jsdelivr.net/npm/lucide-static@1.0.1/icons";
const PAGE_ICON = "file-text";
const written = new Set<string>();
let sheet: HTMLStyleElement | undefined;

const css = (text: string) => JSON.stringify(text);
const mask = (name: string, color: string) =>
  `-webkit-mask: url(${css(`${LUCIDE}/${name}.svg`)}) center / contain no-repeat; mask: url(${css(`${LUCIDE}/${name}.svg`)}) center / contain no-repeat; background-color: ${color};`;
const picture = (src: string) => `background: url(${css(src)}) center / contain no-repeat;`;

/** How an icon (as `$model/icons` stores it) is drawn: an emoji as text, anything else as a box. */
function drawn(icon: string | null | undefined): string {
  const parsed = parseIcon(icon);
  switch (parsed?.kind) {
    case "emoji":
      return `content: ${css(parsed.emoji)};`;
    case "lucide":
      return mask(parsed.name, parsed.color ? `var(--hue-${parsed.color})` : "currentColor");
    case "noto":
      return picture(notoStill(parsed.code));
    case "image":
      return picture(parsed.src);
    case "custom": {
      const custom = emoji.get(parsed.id);
      return custom ? picture(custom.image) : mask(PAGE_ICON, "var(--ink-45)");
    }
    default:
      return mask(PAGE_ICON, "var(--ink-45)");
  }
}

/** The class drawing `icon` before a pill. */
export function iconClass(icon: string | null | undefined) {
  const rule = drawn(icon);
  const name = `script-icon-${[...rule]
    .reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) | 0, 0)
    .toString(36)
    .replace("-", "n")}`;
  if (!written.has(name)) {
    written.add(name);
    sheet ??= document.head.appendChild(document.createElement("style"));
    sheet.append(`.monaco-editor .${name}::before { ${rule} }\n`);
  }
  return name;
}
