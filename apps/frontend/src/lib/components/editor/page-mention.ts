import { mountPill } from "@desk/core/pill";
import Mention from "@tiptap/extension-mention";
import { mount, unmount } from "svelte";
import { isPillUrn } from "$lib/pills";
import { pageIdOf, pageUrl, personIdOf, personUrl, urlOf } from "$model/urn";
import PageMentionView from "./PageMention.svelte";
import PersonMentionView from "./PersonMention.svelte";
import { VIEW_BLOCK } from "./view-block";

/**
 * A page or a person mentioned in text (a `mention` node keyed by its URN, written out as its address): the page's icon and its name, as Notion
 * shows it, or the person's picture and name; no `@`. A record of another app (a Balance block, keyed `balance:block/<id>`) is the shared
 * pill of the kind registered for it (`$lib/pills`). A mentioned view can be turned into the view shown inline (a view
 * block), and back.
 */
export const PageMention = Mention.extend({
  addAttributes() {
    return { ...this.parent?.(), icon: { default: null } };
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", { ...HTMLAttributes, "data-type": "mention", "data-id": node.attrs.id }, node.attrs.label ?? ""];
  },

  /** As text (a yank, a copy): a Markdown link to the page (or the person in People), which pasted back here is a mention again. */
  renderText({ node }) {
    const person = personIdOf(String(node.attrs.id ?? ""));
    if (person) return `[${node.attrs.label ?? ""}](${personUrl(person)})`;
    if (isPillUrn(String(node.attrs.id ?? ""))) return `[${node.attrs.label ?? ""}](${urlOf(String(node.attrs.id))})`;
    const id = pageIdOf(String(node.attrs.id ?? "")) ?? String(node.attrs.id ?? "");
    return `[${node.attrs.label ?? ""}](${pageUrl(id)})`;
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const urn = String(node.attrs.id ?? "");
      const person = personIdOf(urn);
      if (person) {
        const dom = document.createElement("span");
        dom.className = "mention has-icon item-inline";
        dom.dataset.id = urn;
        const view = mount(PersonMentionView, { target: dom, props: { id: person, label: node.attrs.label ?? "" } });
        return { dom, destroy: () => void unmount(view) };
      }
      if (isPillUrn(urn)) {
        const dom = document.createElement("span");
        dom.className = "mention-pill";
        dom.dataset.id = urn;
        return { dom, destroy: mountPill(dom, { urn, label: node.attrs.label ?? "" }) };
      }
      const id = pageIdOf(urn) ?? urn;
      const dom = document.createElement("span");
      dom.className = "mention has-icon item-inline";
      dom.dataset.id = urn;
      /** The mention gives way to the view itself: its line when alone on it, else a block right after the line. */
      const onexpand = () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const $pos = editor.state.doc.resolve(pos);
        const block = { type: VIEW_BLOCK, attrs: { view: id } };
        const [start, end] = [$pos.before(), $pos.after()];
        if ($pos.parent.childCount === 1) editor.chain().insertContentAt({ from: start, to: end }, block).run();
        else
          editor
            .chain()
            .insertContentAt(end, block)
            .deleteRange({ from: pos, to: pos + node.nodeSize })
            .run();
      };
      const view = mount(PageMentionView, {
        target: dom,
        props: {
          id,
          label: node.attrs.label ?? "",
          saved: node.attrs.icon ?? null,
          // Only where a view can be placed: a page's body, not a comment.
          onexpand: editor.isEditable && editor.schema.nodes[VIEW_BLOCK] ? onexpand : undefined,
        },
      });
      return { dom, destroy: () => void unmount(view) };
    };
  },
});
