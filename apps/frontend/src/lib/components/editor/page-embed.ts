import { mergeAttributes, Node } from "@tiptap/core";
import { FileText } from "lucide-svelte";
import { mount, unmount } from "svelte";

/**
 * A block that shows another page in this one — `<keep-page>` reads it, the editor shows a card that opens it.
 */
export const PageEmbed = Node.create<{ href: (urn: string) => string }>({
  name: "pageEmbed",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return { href: (urn: string) => urn };
  },

  addAttributes() {
    return { urn: { default: null }, label: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "div[data-page-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page-embed": "" }), HTMLAttributes.label ?? ""];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("a");
      dom.href = this.options.href(node.attrs.urn);
      dom.className =
        "my-1 flex h-9 items-center gap-2 rounded-sm px-1.5 no-underline transition-colors hover:bg-ink-5";
      dom.contentEditable = "false";
      const icon = document.createElement("span");
      icon.className = "grid size-5 place-items-center text-ink-45";
      const glyph = mount(FileText, { target: icon, props: { size: 16 } });
      const label = document.createElement("span");
      label.className = "truncate font-medium text-ink underline decoration-ink-20 underline-offset-[3px]";
      label.textContent = node.attrs.label || "Untitled";
      const kind = document.createElement("span");
      kind.className = "ml-auto shrink-0 text-[12px] text-ink-30";
      kind.textContent = "Embedded page";
      dom.append(icon, label, kind);
      return { dom, destroy: () => void unmount(glyph) };
    };
  },
});
