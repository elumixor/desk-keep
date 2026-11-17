import { latinKey } from "@desk/editor/latin-key";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { Plugin } from "@tiptap/pm/state";
import { mount, unmount } from "svelte";
import LinkIcon from "./LinkIcon.svelte";
import { openLinkMenu } from "./link-menu";

/** A link as the menu edits it: where it goes and its text. */
export interface LinkEdit {
  readonly href: string;
  readonly text: string;
}

const SAFE = /^(https?:|mailto:|tel:|\/|#)/i;

/** The address a link may open: anything else (`javascript:`…) opens nothing. */
export const safeHref = (href: unknown) => (typeof href === "string" && SAFE.test(href) ? href : "");

/** What is typed as an address, as a link keeps it: a bare `example.com` is `https://example.com`. */
export function normalizeHref(typed: string): string {
  const href = typed.trim();
  if (!href) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#")) return safeHref(href);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`;
  return `https://${href}`;
}

/**
 * A link drawn as a mention is: the site's icon with the link arrow, then its text, underlined. ⌘U opens the menu
 * that edits it, or makes one; ⌘⇧U underlines and ⌘⇧X strikes through.
 */
export const KeepLink = Link.extend({
  addMarkView() {
    return ({ mark }) => {
      const href = safeHref(mark.attrs.href);
      const dom = document.createElement("a");
      dom.className = "link item-inline";
      if (href) dom.href = href;
      dom.target = "_blank";
      dom.rel = "noopener noreferrer nofollow";
      const contentDOM = document.createElement("span");
      const holder = document.createElement("span");
      holder.contentEditable = "false";
      const icon = mount(LinkIcon, { target: holder, props: { href } });
      dom.append(holder, contentDOM);
      return {
        dom,
        contentDOM,
        ignoreMutation: (mutation) => mutation.type !== "selection" && !contentDOM.contains(mutation.target),
        destroy: () => void unmount(icon),
      };
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      ...(this.parent?.() ?? []),
      // A plugin, not a keymap: ahead of Vim, which in normal mode takes every letter, ⌘ or not.
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            // ⌘ only: Ctrl+U stays Vim's half-page scroll.
            if (!event.metaKey || event.ctrlKey || event.altKey) return false;
            const key = latinKey(event).toLowerCase();
            if (!event.shiftKey && key === "u") {
              // The caret an arrow key just moved may not be read back yet: the menu needs the link it is in.
              (view as unknown as { domObserver: { flush(): void } }).domObserver.flush();
              openLinkMenu(editor);
            } else if (event.shiftKey && key === "u") editor.commands.toggleUnderline();
            else if (event.shiftKey && key === "x") editor.commands.toggleStrike();
            else return false;
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

/** Underline on ⌘⇧U (the link's plugin), not ⌘U, which is the link menu's. */
export const KeepUnderline = Underline.extend({
  addKeyboardShortcuts() {
    return {};
  },
});
