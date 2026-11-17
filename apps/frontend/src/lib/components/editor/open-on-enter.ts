import { vimPluginKey } from "@desk/editor";
import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { type EditorState, NodeSelection } from "@tiptap/pm/state";
import { goto } from "$app/navigation";
import { personIdOf } from "$model/urn";
import { safeHref } from "./link";

type Target = { readonly urn: string } | { readonly url: string };

/** The page a mention or an embed names, or the address of linked text; nothing for anything else. */
function targetOf(node: PmNode | null | undefined): Target | null {
  if (!node) return null;
  if (node.type.name === "mention" && node.attrs.id) return { urn: String(node.attrs.id) };
  if (node.type.name === "pageEmbed" && node.attrs.urn) return { urn: String(node.attrs.urn) };
  const url = safeHref(node.marks.find((m) => m.type.name === "link")?.attrs.href);
  return node.isText && url ? { url } : null;
}

/**
 * What the selection is: one mention or embed, or text of one link (all of it or part); in Vim's normal mode, what
 * the cursor is on.
 */
function selected(state: EditorState): Target | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) return targetOf(selection.node);
  if (selection.empty) {
    const vim = vimPluginKey.getState(state);
    return vim?.mode === "normal" ? targetOf(selection.$head.nodeAfter) : null;
  }
  const found: (Target | null)[] = [];
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isInline) found.push(targetOf(node));
  });
  const [first] = found;
  if (!first) return null;
  const same = (t: Target | null) =>
    !!t && ("urn" in first ? "urn" in t && t.urn === first.urn : "url" in t && t.url === first.url);
  // A mention is one node: selected once, not next to text.
  return found.every(same) && ("url" in first || found.length === 1) ? first : null;
}

/** Enter on a selected mention, embed or link opens it, as a click does: a page here, a person or a link in a new tab. */
export const OpenOnEnter = Extension.create<{ href: (urn: string) => string }>({
  name: "openOnEnter",
  // Ahead of Vim's Enter (down a line) and of splitting the block.
  priority: 1000,
  addOptions() {
    return { href: (urn: string) => urn };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const target = selected(editor.state);
        if (!target) return false;
        // A person opens in People, in a new tab, as a link does.
        if ("urn" in target && !personIdOf(target.urn)) void goto(this.options.href(target.urn));
        else window.open("urn" in target ? this.options.href(target.urn) : target.url, "_blank", "noopener");
        return true;
      },
    };
  },
});
